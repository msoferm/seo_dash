/**
 * POST { client_id, months? }  (months: 3 | 6 | 12)
 * Builds the unified recommendation list from GSC/ZEFO data (data-driven, no LLM):
 * title/meta, improve-page, new-content, cannibalization — each scored with an estimated
 * number of new monthly visits, potential, and effort. Replaces the client's PENDING
 * recommendations; keeps ones already applied/ignored/done (and won't re-suggest them).
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";

function expectedCtr(pos: number): number {
  const t: Record<number, number> = { 1: 0.30, 2: 0.15, 3: 0.10, 4: 0.07, 5: 0.05, 6: 0.04, 7: 0.035, 8: 0.03, 9: 0.025, 10: 0.02 };
  const p = Math.round(pos);
  if (p <= 1) return 0.30;
  if (p >= 11) return 0.012;
  return t[p] ?? 0.02;
}
function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function potentialOf(v: number) { return v >= 50 ? "high" : v >= 15 ? "medium" : "low"; }

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, months = 3 } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);
    const m = [3, 6, 12].includes(months) ? months : 3;
    const to = ymd(new Date());
    const from = ymd(new Date(Date.now() - m * 30 * 86400000));

    // Two sub-periods for drop detection (recent half vs prior half)
    const half = Math.max(1, Math.round(m / 2));
    const recentFrom = ymd(new Date(Date.now() - half * 30 * 86400000));
    const priorFrom = ymd(new Date(Date.now() - 2 * half * 30 * 86400000));
    const priorTo = recentFrom;

    const [{ data: opps }, { data: pmap }, { data: actioned }, { data: oppsRecent }, { data: oppsPrior }] = await Promise.all([
      sb.rpc("gsc_query_opportunities", { p_client_id: client_id, p_from: from, p_to: to }),
      sb.rpc("gsc_page_query_map", { p_client_id: client_id, p_from: from, p_to: to }),
      sb.from("recommendations").select("dedupe_key").eq("client_id", client_id).neq("status", "pending"),
      sb.rpc("gsc_query_opportunities", { p_client_id: client_id, p_from: recentFrom, p_to: to }),
      sb.rpc("gsc_query_opportunities", { p_client_id: client_id, p_from: priorFrom, p_to: priorTo }),
    ]);
    const done = new Set((actioned || []).map((r: any) => r.dedupe_key).filter(Boolean));

    // term -> best page, and term -> #pages (cannibalization)
    const termBestPage = new Map<string, { page: string; clicks: number; impressions: number }>();
    const termPages = new Map<string, Set<string>>();
    for (const r of (pmap || []) as any[]) {
      const cur = termBestPage.get(r.term);
      if (!cur || r.clicks > cur.clicks || (r.clicks === cur.clicks && r.impressions > cur.impressions)) {
        termBestPage.set(r.term, { page: r.page, clicks: r.clicks, impressions: r.impressions });
      }
      if ((r.impressions || 0) >= 20) { const s = termPages.get(r.term) || new Set(); s.add(r.page); termPages.set(r.term, s); }
    }

    const recs: any[] = [];
    const push = (rec: any) => {
      const dedupe_key = `${rec.type}|${rec.page || ""}|${rec.keyword || ""}`;
      if (done.has(dedupe_key)) return;
      recs.push({ client_id, status: "pending", dedupe_key, ...rec });
    };
    const monthly = (periodTotal: number) => periodTotal / m;

    for (const o of (opps || []) as any[]) {
      const term = o.term; const pos = o.position; const impr = o.impressions; const ctr = o.ctr;
      const page = termBestPage.get(term)?.page || null;
      const imprM = monthly(impr);

      // Cannibalization
      const pagesForTerm = termPages.get(term);
      if (pagesForTerm && pagesForTerm.size >= 2) {
        push({
          type: "cannibalization", source: "gsc", page, keyword: term,
          title: `קניבליזציה: ${term}`,
          opportunity: `הביטוי "${term}" מדורג על ${pagesForTerm.size} עמודים (${impr} חשיפות, מיקום ${pos}).`,
          whats_missing: "פיצול כוח בין כמה עמודים על אותה כוונת חיפוש.",
          action: `לבחור עמוד ראשי אחד ל"${term}", למקד בו את התוכן, ולחזק אליו קישורים פנימיים מהעמודים האחרים (או להפנות).`,
          potential: "medium", est_visits: Math.round(imprM * 0.02), effort: "medium", confidence: "medium",
          score: impr * 0.5,
        });
      }

      // Low CTR → title/meta
      if (impr >= 50 && pos <= 20 && ctr < expectedCtr(pos) * 0.6) {
        const est = Math.max(0, Math.round(imprM * (expectedCtr(pos) - ctr)));
        push({
          type: "title_meta", source: "gsc", page, keyword: term,
          title: `כותרת/תיאור: ${term}`,
          opportunity: `"${term}" במיקום ${pos} עם ${impr} חשיפות, אך CTR ${(ctr * 100).toFixed(1)}% נמוך מהצפוי למיקום.`,
          whats_missing: "הכותרת והתיאור לא מזמינים מספיק ביחס למיקום.",
          action: `לשכתב כותרת SEO ותיאור מטא שמדגישים "${term}" עם יתרון/מספר/מיקום/תשובה ברורה.`,
          potential: potentialOf(est), est_visits: est, effort: "low", confidence: "high",
          score: est * 1.2,
        });
      }

      // Near first page (8-20) → improve page
      if (impr >= 30 && pos >= 8 && pos <= 20) {
        const est = Math.max(0, Math.round(imprM * (expectedCtr(7) - ctr)));
        push({
          type: "improve_page", source: "gsc", page, keyword: term,
          title: `שיפור עמוד: ${term}`,
          opportunity: `"${term}" במיקום ${pos} עם ${impr} חשיפות — קרוב לעמוד הראשון, פוטנציאל צמיחה מהיר.`,
          whats_missing: "חסר עומק תוכן/כותרות/שאלות סביב הביטוי כדי לדחוף לעמוד הראשון.",
          action: `להרחיב את העמוד: כותרות משנה, שאלות ותשובות, מונחים קשורים, וקישורים פנימיים סביב "${term}".`,
          potential: potentialOf(est), est_visits: est, effort: "medium", confidence: "medium",
          score: est,
        });
      }

      // Weak position but demand → new content
      if (impr >= 25 && pos > 20) {
        const est = Math.max(0, Math.round(imprM * expectedCtr(7) * 0.4));
        push({
          type: "new_content", source: "gsc", page: null, keyword: term,
          title: `תוכן חדש: ${term}`,
          opportunity: `"${term}" מקבל ${impr} חשיפות אך מדורג חלש (מיקום ${pos}) — אין עמוד חזק שעונה על הצורך.`,
          whats_missing: "אין עמוד ייעודי שעונה במלואו על כוונת החיפוש.",
          action: `ליצור עמוד/מאמר ייעודי ומקיף ל"${term}" (או להרחיב עמוד קרוב אם קיים).`,
          potential: potentialOf(est), est_visits: est, effort: "high", confidence: "low",
          score: est * 0.8,
        });
      }
    }

    // Performance drops: recent half vs prior half
    const recentByTerm = new Map<string, any>();
    for (const r of (oppsRecent || []) as any[]) recentByTerm.set(r.term, r);
    for (const p of (oppsPrior || []) as any[]) {
      const rec = recentByTerm.get(p.term) || { clicks: 0, impressions: 0, position: 0 };
      if (p.clicks >= 5 && rec.clicks < p.clicks * 0.6) {
        const lost = p.clicks - rec.clicks;
        const lostMonthly = Math.round(lost / half);
        const page = termBestPage.get(p.term)?.page || null;
        push({
          type: "performance_drop", source: "gsc", page, keyword: p.term,
          title: `ירידת ביצועים: ${p.term}`,
          opportunity: `"${p.term}" ירד מ-${p.clicks} ל-${rec.clicks} קליקים (מיקום ${p.position} → ${rec.position || "לא מדורג"}) בין התקופות.`,
          whats_missing: "העמוד איבד תנועה — ייתכן ירידת מיקום, תוכן שהתיישן, או תחרות חדשה.",
          action: `לבדוק ולרענן את העמוד: עדכון תוכן, חיזוק סביב "${p.term}", ובדיקת מתחרים חדשים בתוצאות.`,
          potential: potentialOf(lostMonthly), est_visits: lostMonthly, effort: "medium", confidence: "medium",
          score: lost * 1.6,
        });
      }
    }

    // Replace pending, keep actioned
    await sb.from("recommendations").delete().eq("client_id", client_id).eq("status", "pending");
    // de-dup within this batch by dedupe_key (keep highest score)
    const byKey = new Map<string, any>();
    for (const r of recs) { const ex = byKey.get(r.dedupe_key); if (!ex || r.score > ex.score) byKey.set(r.dedupe_key, r); }
    const finalRows = [...byKey.values()];
    if (finalRows.length > 0) {
      const { error } = await sb.from("recommendations").insert(finalRows);
      if (error) throw new Error(error.message);
    }
    return jsonResponse({ count: finalRows.length, months: m });
  } catch (e) {
    return errorResponse(`שגיאה ביצירת ההמלצות: ${(e as Error).message}`, 500);
  }
});
