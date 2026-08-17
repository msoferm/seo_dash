/**
 * POST { client_id, from, to, instructions?, current_summary?, current_recommendations? }
 * Gathers accurate SEO metrics for the period (+ the previous period for growth context)
 * and asks Claude to draft two optimistic-but-truthful Hebrew blocks: "סיכום פעילות"
 * and "המלצות להמשך". With `instructions`, it revises the existing text instead.
 * Returns { summary, recommendations }.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL } from "../_shared/anthropic.ts";
import { stripJsonFence } from "../_shared/faq_prompts.ts";

function isOrganic(channel: string | null): boolean {
  return !!channel && /organic/i.test(channel);
}

/** Rough organic CTR-by-position curve (0-1) — CTR is only "low" relative to position. */
function expectedCtr(pos: number): number {
  const t: Record<number, number> = { 1: 0.30, 2: 0.15, 3: 0.10, 4: 0.07, 5: 0.05, 6: 0.04, 7: 0.035, 8: 0.03, 9: 0.025, 10: 0.02 };
  const p = Math.round(pos);
  if (p <= 1) return 0.30;
  if (p >= 11) return 0.012;
  return t[p] ?? 0.02;
}

/** GSC + conversion totals for a [from,to] window. */
async function windowTotals(sb: any, clientId: number, from: string, to: string) {
  const [gscRes, convRes] = await Promise.all([
    sb.from("gsc_daily_totals").select("clicks, impressions, position").eq("client_id", clientId).gte("date", from).lte("date", to),
    sb.from("ga4_conversions").select("channel, source, conversions, sessions").eq("client_id", clientId).gte("date", from).lte("date", to),
  ]);
  const gsc = gscRes.data || [];
  let clicks = 0, impressions = 0, wPos = 0;
  for (const r of gsc) { clicks += r.clicks || 0; impressions += r.impressions || 0; wPos += (r.position || 0) * (r.impressions || 0); }
  const avgPos = impressions > 0 ? Math.round((wPos / impressions) * 10) / 10 : null;
  const conv = convRes.data || [];
  let totalConv = 0, organicConv = 0, totalSess = 0;
  const bySrc = new Map<string, number>();
  for (const r of conv) {
    totalConv += r.conversions || 0;
    if (isOrganic(r.channel)) organicConv += r.conversions || 0;
    totalSess += r.sessions || 0;
    const label = r.channel || r.source || "לא ידוע";
    bySrc.set(label, (bySrc.get(label) || 0) + (r.conversions || 0));
  }
  return { clicks, impressions, avgPos, totalConv, organicConv, totalSess, bySrc, hasData: gsc.length > 0 || conv.length > 0 };
}

function prevRange(from: string, to: string): { from: string; to: string } {
  const f = new Date(from), t = new Date(to);
  const lenDays = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
  const prevTo = new Date(f.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (lenDays - 1) * 86400000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  return { from: ymd(prevFrom), to: ymd(prevTo) };
}

function pct(cur: number, prev: number): string {
  if (!prev) return cur > 0 ? "עלייה" : "—";
  const d = Math.round(((cur - prev) / prev) * 100);
  return d >= 0 ? `+${d}%` : `${d}%`;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, from, to, instructions, current_summary, current_recommendations } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);
    if (!from || !to) return errorResponse("חסר טווח תאריכים", 400);
    const hasInstructions = typeof instructions === "string" && instructions.trim().length > 0;

    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);

    const cur = await windowTotals(sb, client_id, from, to);
    const pr = prevRange(from, to);
    const prev = await windowTotals(sb, client_id, pr.from, pr.to);

    const [zefoRes, linksRes, kwRes] = await Promise.all([
      sb.from("zefo_keywords").select("keyword, ranking, previous_ranking, initial_ranking, best_rank, local_searches").eq("client_id", client_id).order("ranking", { ascending: true, nullsFirst: false }).limit(40),
      sb.from("report_links").select("link_type, url").eq("client_id", client_id).gte("done_on", from).lte("done_on", to),
      sb.from("keywords").select("term, monthly_searches").eq("client_id", client_id).order("monthly_searches", { ascending: false }).limit(12),
    ]);
    const zefo = zefoRes.data || [];
    const links = linksRes.data || [];
    const kw = kwRes.data || [];

    // Ranking wins (improved vs initial)
    const improved = zefo.filter((z: any) => z.initial_ranking != null && z.ranking != null && z.ranking < z.initial_ranking);
    const inTop10 = zefo.filter((z: any) => z.ranking != null && z.ranking <= 10);

    const linkTypes = new Map<string, number>();
    for (const l of links) linkTypes.set(l.link_type, (linkTypes.get(l.link_type) || 0) + 1);

    // GSC opportunity analyses (query-level) for automatic recommendations
    let nearFirstPage: any[] = [];
    let lowCtr: any[] = [];
    try {
      const { data: oppRows } = await sb.rpc("gsc_query_opportunities", { p_client_id: client_id, p_from: from, p_to: to });
      const rows = (oppRows || []) as any[];
      nearFirstPage = rows
        .filter((r) => r.position >= 8 && r.position <= 20 && r.impressions >= 30)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 12);
      lowCtr = rows
        .filter((r) => r.impressions >= 50 && r.ctr < expectedCtr(r.position) * 0.6)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 12);
    } catch (_) { /* opportunities are best-effort */ }

    const fmt = (arr: any[], f: (x: any) => string) => (arr.length ? arr.map(f).join("\n") : "אין נתונים");

    const context = `לקוח: ${client.name} (דומיין: ${client.domain})
הערות על העסק: ${client.notes || "אין"}
תקופת הדוח: ${from} עד ${to}

--- תנועה אורגנית (Google Search Console) ---
קליקים אורגניים: ${cur.clicks.toLocaleString()} (תקופה קודמת: ${prev.clicks.toLocaleString()}, שינוי: ${pct(cur.clicks, prev.clicks)})
חשיפות: ${cur.impressions.toLocaleString()} (תקופה קודמת: ${prev.impressions.toLocaleString()}, שינוי: ${pct(cur.impressions, prev.impressions)})
מיקום ממוצע: ${cur.avgPos ?? "—"} (תקופה קודמת: ${prev.avgPos ?? "—"})

--- המרות (GA4) ---
המרות אורגניות: ${cur.organicConv.toLocaleString()} (תקופה קודמת: ${prev.organicConv.toLocaleString()}, שינוי: ${pct(cur.organicConv, prev.organicConv)})
סה"כ המרות (כל הערוצים): ${cur.totalConv.toLocaleString()}

--- מיקומים אורגניים (ZEFO) ---
סה"כ מילים במעקב: ${zefo.length} | מתוכן ב-TOP 10: ${inTop10.length} | מילים שהשתפרו מהמיקום ההתחלתי: ${improved.length}
דוגמאות שיפור (מילה | התחלתי → נוכחי):
${fmt(improved.slice(0, 12), (z: any) => `- ${z.keyword} | ${z.initial_ranking} → ${z.ranking}`)}
מילים מובילות (מילה | מיקום נוכחי | חיפושים):
${fmt(zefo.slice(0, 15), (z: any) => `- ${z.keyword} | ${z.ranking ?? "—"} | ${z.local_searches ?? "—"}`)}

--- קישורים חיצוניים שבוצעו בתקופה: ${links.length} ---
${fmt([...linkTypes.entries()], ([t, c]) => `- ${t}: ${c}`)}

--- מילות מפתח מרכזיות (נפח חיפוש) ---
${fmt(kw, (k: any) => `- ${k.term} (${k.monthly_searches})`)}

--- הזדמנות א': ביטויים קרובים לעמוד הראשון (מיקום 8-20, חשיפות 30+) — פוטנציאל צמיחה מהיר ---
(מילה | מיקום | חשיפות | קליקים)
${fmt(nearFirstPage, (r: any) => `- ${r.term} | ${r.position} | ${r.impressions} | ${r.clicks}`)}

--- הזדמנות ב': חשיפות גבוהות ו-CTR נמוך ביחס למיקום — שיפור כותרת/תיאור ---
(מילה | מיקום | חשיפות | CTR בפועל)
${fmt(lowCtr, (r: any) => `- ${r.term} | ${r.position} | ${r.impressions} | ${(r.ctr * 100).toFixed(1)}%`)}`;

    let system =
      "אתה מנהל קידום אורגני (SEO) מקצועי שכותב דוח חודשי חיובי ומעודד ללקוח. " +
      "הטון חייב להיות אופטימי, בונה ומדגיש התקדמות והישגים — הלקוח צריך להרגיש שהעבודה משתלמת והאתר בכיוון הנכון. " +
      "השתמש אך ורק במספרים האמיתיים שסופקו, אך הצג אותם באור החיובי ביותר: הדגש צמיחה, שיפור מיקומים, מילים שנכנסו ל-TOP 10, קישורים שנבנו ותוכן שנוסף. " +
      "אם מדד מסוים נמוך או לא השתנה — אל תתמקד בו לרעה; במקום זאת מסגר אותו כהזדמנות והצג את הצעד הבא. לעולם אל תמציא נתונים. " +
      "כתוב בעברית, בלי סימני מרקדאון, בשני חלקים: " +
      "1) 'summary' — סיכום פעילות והישגי החודש (2-4 פסקאות קצרות). " +
      "2) 'recommendations' — המלצות להמשך קונקרטיות, מבוססות-נתונים ומדויקות לפי שתי ההזדמנויות שסופקו: " +
      "עבור 'ביטויים קרובים לעמוד הראשון' — פרט אילו ביטויים ספציפיים לחזק ואיך (שיפור תוכן העמוד, כותרות ופסקאות סביב הביטוי, שאלות ותשובות, קישורים פנימיים, התאמת כוונת החיפוש). " +
      "עבור 'חשיפות גבוהות ו-CTR נמוך' — פרט אילו ביטויים לשפר להם כותרת SEO ותיאור Meta (הוספת יתרון/מספר/מיקום/מחיר/תשובה ברורה). " +
      "ציין שמות ביטויים אמיתיים מהרשימות. אם רשימה ריקה — דלג עליה. סה\"כ 4-8 המלצות. " +
      "החזר אך ורק JSON תקין: {\"summary\":\"...\",\"recommendations\":\"...\"}.";

    let userContent = context;
    if (hasInstructions) {
      system +=
        " חשוב: קיים כבר טקסט דוח, והמשתמש נותן הוראות מדויקות מה לתקן או לשנות בו. " +
        "בצע את ההוראות במדויק, אך המשך לשמור על טון חיובי ועל דיוק מוחלט לנתונים.";
      userContent +=
        `\n\n--- הטקסט הנוכחי של הדוח ---\nסיכום פעילות:\n${current_summary || "(ריק)"}\n\nהמלצות להמשך:\n${current_recommendations || "(ריק)"}\n\n` +
        `--- הוראות המשתמש לתיקון ---\n${instructions.trim()}\n\nהחזר את הטקסט המעודכן באותו מבנה JSON.`;
    }

    const resp = await callClaude({
      model: DEFAULT_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: userContent }],
    });

    const raw = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    let parsed: any;
    try {
      parsed = JSON.parse(stripJsonFence(raw));
    } catch {
      return errorResponse(`קלוד החזיר תשובה שלא ניתן לפענח: ${raw.slice(0, 200)}`, 502);
    }

    return jsonResponse({
      summary: String(parsed.summary || "").trim(),
      recommendations: String(parsed.recommendations || "").trim(),
    });
  } catch (e) {
    return errorResponse(`שגיאה ביצירת הדוח: ${(e as Error).message}`, 500);
  }
});
