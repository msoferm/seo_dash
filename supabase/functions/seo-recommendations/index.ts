/**
 * POST { client_id, from, to }
 * INTERNAL (team-facing) SEO recommendations — NOT for the client report.
 * Pulls four GSC analyses and asks Claude for a concrete, prioritized action list
 * naming the real keywords/pages:
 *   1) near-first-page (position 8-20)
 *   2) high impressions + low CTR (title/meta)
 *   3) query-map-per-page / cannibalization
 *   4) new keywords worth building content from
 * Returns { recommendations }.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL } from "../_shared/anthropic.ts";
import { stripJsonFence } from "../_shared/faq_prompts.ts";

function expectedCtr(pos: number): number {
  const t: Record<number, number> = { 1: 0.30, 2: 0.15, 3: 0.10, 4: 0.07, 5: 0.05, 6: 0.04, 7: 0.035, 8: 0.03, 9: 0.025, 10: 0.02 };
  const p = Math.round(pos);
  if (p <= 1) return 0.30;
  if (p >= 11) return 0.012;
  return t[p] ?? 0.02;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, from, to } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);
    if (!from || !to) return errorResponse("חסר טווח תאריכים", 400);

    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);

    const [{ data: oppRows }, { data: mapRows }, zefoRes] = await Promise.all([
      sb.rpc("gsc_query_opportunities", { p_client_id: client_id, p_from: from, p_to: to }),
      sb.rpc("gsc_page_query_map", { p_client_id: client_id, p_from: from, p_to: to }),
      sb.from("zefo_keywords").select("keyword, ranking, local_searches").eq("client_id", client_id).order("ranking", { ascending: true, nullsFirst: false }).limit(30),
    ]);

    const rows = (oppRows || []) as any[];
    const nearFirstPage = rows.filter((r) => r.position >= 8 && r.position <= 20 && r.impressions >= 30).sort((a, b) => b.impressions - a.impressions).slice(0, 15);
    const lowCtr = rows.filter((r) => r.impressions >= 50 && r.ctr < expectedCtr(r.position) * 0.6).sort((a, b) => b.impressions - a.impressions).slice(0, 15);
    // Candidate topics for new content: queries with impressions but weak position (not yet ranking well)
    const newContent = rows.filter((r) => r.position > 15 && r.impressions >= 30).sort((a, b) => b.impressions - a.impressions).slice(0, 25);

    // Page-query map + cannibalization
    const pmRows = (mapRows || []) as any[];
    const termPages = new Map<string, { page: string; impressions: number }[]>();
    const byPage = new Map<string, any[]>();
    for (const r of pmRows) {
      const tp = termPages.get(r.term) || []; tp.push({ page: r.page, impressions: r.impressions }); termPages.set(r.term, tp);
      const bp = byPage.get(r.page) || []; bp.push(r); byPage.set(r.page, bp);
    }
    const cannibal: string[] = [];
    for (const [term, pages] of termPages) {
      const strong = pages.filter((p) => p.impressions >= 20);
      if (strong.length >= 2) cannibal.push(`${term} → ${strong.length} עמודים (${strong.sort((a,b)=>b.impressions-a.impressions).slice(0,3).map((p) => p.page).join(" | ")})`);
    }
    const pageLines: string[] = [];
    for (const [page, prows] of byPage) {
      const sorted = prows.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
      const imp = prows.reduce((s, r) => s + r.impressions, 0);
      pageLines.push(`- ${page} | ראשי: ${sorted[0]?.term} | משניים: ${sorted.slice(1, 4).map((r) => r.term).join(", ") || "—"} | חשיפות: ${imp}`);
    }
    pageLines.sort((a, b) => (Number(b.split("חשיפות: ")[1]) || 0) - (Number(a.split("חשיפות: ")[1]) || 0));

    const zefo = (zefoRes.data || []).filter((z: any) => z.ranking != null && z.ranking > 0);
    const fmt = (arr: any[], f: (x: any) => string) => (arr.length ? arr.map(f).join("\n") : "אין נתונים");

    const context = `לקוח: ${client.name} (דומיין: ${client.domain}). התעלם מביטויי מותג (שם הלקוח/הדומיין).
הערות: ${client.notes || "אין"}
תקופה: ${from} עד ${to}

[1] ביטויים קרובים לעמוד הראשון (מיקום 8-20, חשיפות 30+):
(מילה | מיקום | חשיפות | קליקים)
${fmt(nearFirstPage, (r) => `- ${r.term} | ${r.position} | ${r.impressions} | ${r.clicks}`)}

[2] חשיפות גבוהות ו-CTR נמוך ביחס למיקום:
(מילה | מיקום | חשיפות | CTR)
${fmt(lowCtr, (r) => `- ${r.term} | ${r.position} | ${r.impressions} | ${(r.ctr * 100).toFixed(1)}%`)}

[3] מפת שאילתות לכל עמוד (לזיהוי קניבליזציה וחידוד תוכן):
${fmt(pageLines.slice(0, 25), (l) => l)}
קניבליזציה שזוהתה (אותו ביטוי מוביל לכמה עמודים):
${cannibal.length ? cannibal.slice(0, 12).map((c) => `- ${c}`).join("\n") : "לא זוהתה"}

[4] ביטויים עם חשיפות אך מיקום חלש (מועמדים לתוכן חדש):
(מילה | מיקום | חשיפות)
${fmt(newContent, (r) => `- ${r.term} | ${r.position} | ${r.impressions}`)}

מיקומים נוכחיים מובילים (ZEFO):
${fmt(zefo.slice(0, 15), (z: any) => `- ${z.keyword} | ${z.ranking}`)}`;

    const system =
      "אתה מומחה SEO שמכין רשימת פעולות פנימית לצוות (לא ללקוח). על בסיס הנתונים, כתוב המלצות מעשיות, ממוקדות ומתועדפות, בעברית, בלי סימני מרקדאון. " +
      "חלק לארבעה חלקים ברורים עם כותרות: " +
      "1) 'ביטויים קרובים לעמוד הראשון' — לכל ביטוי מרכזי: שיפור תוכן, כותרות ופסקאות סביב הביטוי, שאלות ותשובות, קישורים פנימיים, התאמת כוונת חיפוש. " +
      "2) 'חשיפות גבוהות ו-CTR נמוך' — לכל ביטוי: שיפור כותרת SEO ותיאור Meta (יתרון/מספר/מיקום/מחיר/תשובה ברורה), בדיקה מול מתחרים. " +
      "3) 'מפת שאילתות וקניבליזציה' — היכן אותו ביטוי מוביל לכמה עמודים (איחוד/הבהרה איזה עמוד ראשי + קישורים פנימיים), והיכן עמוד מדורג לביטויים שלא תואמים את מטרתו (חידוד תוכן). " +
      "4) 'ביטויים חדשים לפיתוח תוכן' — זהה נושאים שגוגל מתחיל לשייך לאתר: שאלות ללא תשובה מלאה, שירותים/תתי-שירותים בלי עמוד, כוונה מקומית, ביטויי מחיר/השוואה/המלצה/זמן/תהליך. קבץ ביטויים סביב אותו נושא לעמוד מקיף אחד במקום עמוד לכל ביטוי, וציין אם להרחיב עמוד קיים או ליצור חדש. " +
      "התעלם מביטויי מותג. ציין שמות ביטויים/עמודים אמיתיים. אם חלק ריק — ציין שאין כרגע נתונים מספיקים. " +
      "החזר אך ורק JSON תקין: {\"recommendations\":\"...\"}.";

    const resp = await callClaude({
      model: DEFAULT_MODEL,
      max_tokens: 3500,
      system,
      messages: [{ role: "user", content: context }],
    });

    const raw = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    let parsed: any;
    try {
      parsed = JSON.parse(stripJsonFence(raw));
    } catch {
      return errorResponse(`קלוד החזיר תשובה שלא ניתן לפענח: ${raw.slice(0, 200)}`, 502);
    }
    return jsonResponse({ recommendations: String(parsed.recommendations || "").trim() });
  } catch (e) {
    return errorResponse(`שגיאה ביצירת ההמלצות: ${(e as Error).message}`, 500);
  }
});
