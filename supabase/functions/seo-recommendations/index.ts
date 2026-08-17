/**
 * POST { client_id, from, to }
 * INTERNAL (team-facing) SEO recommendations — NOT for the client report.
 * Pulls the two GSC opportunity analyses (near-first-page, high-impressions/low-CTR)
 * + rankings, and asks Claude for a concrete, prioritized action list naming the real
 * keywords. Returns { recommendations }.
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

    const [{ data: oppRows }, zefoRes] = await Promise.all([
      sb.rpc("gsc_query_opportunities", { p_client_id: client_id, p_from: from, p_to: to }),
      sb.from("zefo_keywords").select("keyword, ranking, initial_ranking, best_rank, local_searches").eq("client_id", client_id).order("ranking", { ascending: true, nullsFirst: false }).limit(40),
    ]);

    const rows = (oppRows || []) as any[];
    const nearFirstPage = rows
      .filter((r) => r.position >= 8 && r.position <= 20 && r.impressions >= 30)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 15);
    const lowCtr = rows
      .filter((r) => r.impressions >= 50 && r.ctr < expectedCtr(r.position) * 0.6)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 15);
    const zefo = (zefoRes.data || []).filter((z: any) => z.ranking != null && z.ranking > 0);

    const fmt = (arr: any[], f: (x: any) => string) => (arr.length ? arr.map(f).join("\n") : "אין נתונים");

    const context = `לקוח: ${client.name} (דומיין: ${client.domain})
הערות: ${client.notes || "אין"}
תקופה: ${from} עד ${to}

הזדמנות א' — ביטויים קרובים לעמוד הראשון (מיקום 8-20, חשיפות 30+). פוטנציאל הצמיחה המהיר ביותר:
(מילה | מיקום | חשיפות | קליקים)
${fmt(nearFirstPage, (r) => `- ${r.term} | ${r.position} | ${r.impressions} | ${r.clicks}`)}

הזדמנות ב' — חשיפות גבוהות ו-CTR נמוך ביחס למיקום (שיפור כותרת/תיאור):
(מילה | מיקום | חשיפות | CTR בפועל)
${fmt(lowCtr, (r) => `- ${r.term} | ${r.position} | ${r.impressions} | ${(r.ctr * 100).toFixed(1)}%`)}

מיקומים נוכחיים מובילים (ZEFO) — מילה | מיקום | חיפושים:
${fmt(zefo.slice(0, 20), (z: any) => `- ${z.keyword} | ${z.ranking} | ${z.local_searches ?? "—"}`)}`;

    const system =
      "אתה מומחה SEO שמכין רשימת פעולות פנימית לצוות (לא ללקוח). על בסיס הנתונים, כתוב המלצות מעשיות, ממוקדות ומתועדפות. " +
      "חלק לשני חלקים ברורים: " +
      "א) 'ביטויים קרובים לעמוד הראשון' — לכל ביטוי מרכזי ציין את הפעולות: שיפור תוכן העמוד, הוספת כותרות ופסקאות סביב הביטוי, שאלות ותשובות, חיזוק קישורים פנימיים לעמוד, ובדיקת התאמת כוונת החיפוש לתוכן. " +
      "ב) 'חשיפות גבוהות ו-CTR נמוך' — לכל ביטוי ציין: שיפור כותרת ה-SEO ותיאור ה-Meta (הוספת יתרון/מספר/מיקום/מחיר/תשובה ברורה), ובדיקה מול המתחרים. " +
      "ציין שמות ביטויים אמיתיים מהרשימות ותעדף לפי חשיפות/פוטנציאל. כתוב בעברית, קצר וקונקרטי, בלי סימני מרקדאון. " +
      "אם רשימה ריקה — ציין שאין כרגע נתונים מספיקים לתחום הזה. " +
      "החזר אך ורק JSON תקין: {\"recommendations\":\"...\"}.";

    const resp = await callClaude({
      model: DEFAULT_MODEL,
      max_tokens: 2500,
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
