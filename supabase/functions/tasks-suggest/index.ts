/**
 * POST { client_id: number }
 * Gathers the client's SEO data (keywords, ZEFO rankings, GA4 conversions, GSC stats)
 * and asks Claude to propose concrete, actionable SEO tasks. Inserts them into `tasks`
 * with source='claude' and returns the created rows.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL } from "../_shared/anthropic.ts";
import { stripJsonFence } from "../_shared/faq_prompts.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);

    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);

    // Gather data in parallel
    const [topKwRes, zefoRes, convRes, statsRes] = await Promise.all([
      sb.from("keywords").select("term, monthly_searches, competition").eq("client_id", client_id).order("monthly_searches", { ascending: false }).limit(15),
      sb.from("zefo_keywords").select("keyword, ranking, previous_ranking, best_rank").eq("client_id", client_id).order("ranking", { ascending: true, nullsFirst: false }).limit(25),
      sb.from("ga4_conversions").select("source, channel, conversions, sessions").eq("client_id", client_id).order("conversions", { ascending: false }).limit(10),
      sb.from("client_stats").select("*").eq("client_id", client_id).maybeSingle(),
    ]);

    const topKw = topKwRes.data || [];
    const zefo = zefoRes.data || [];
    const conv = convRes.data || [];
    const stats = statsRes.data || {};

    const fmt = (arr: any[], f: (x: any) => string) => arr.length ? arr.map(f).join("\n") : "אין נתונים";

    const context = `לקוח: ${client.name} (דומיין: ${client.domain})
הערות על העסק: ${client.notes || "אין"}

סטטיסטיקות כלליות:
- מילות מפתח במעקב: ${stats.keyword_count ?? "—"}
- עמודים: ${stats.page_count ?? "—"} (מתוכם עם FAQ: ${stats.pages_with_faq ?? "—"})
- קליקים אורגניים (90 ימים): ${stats.gsc_clicks ?? "—"}
- חשיפות: ${stats.gsc_impressions ?? "—"}
- מיקום ממוצע: ${stats.avg_position ?? "—"}

מילות מפתח לפי נפח חיפוש (Keyword Planner):
${fmt(topKw, (k) => `- ${k.term} | נפח: ${k.monthly_searches} | תחרות: ${k.competition || "—"}`)}

מיקומים בגוגל (ZEFO) — מילה | מיקום נוכחי | מיקום קודם | הכי טוב:
${fmt(zefo, (z) => `- ${z.keyword} | ${z.ranking ?? "—"} | ${z.previous_ranking ?? "—"} | ${z.best_rank ?? "—"}`)}

המרות לפי מקור תנועה (GA4, החלון האחרון):
${fmt(conv, (c) => `- ${c.source || c.channel || "(ישיר)"} | המרות: ${c.conversions} | סשנים: ${c.sessions}`)}`;

    const system =
      "אתה יועץ SEO אורגני מומחה. בהינתן נתוני לקוח, הצע משימות עבודה קונקרטיות, מעשיות וברות-ביצוע לשיפור ה-SEO האורגני וההמרות. " +
      "התמקד במה שיזיז את המחט: מילים עם פוטנציאל (מיקום 4-20 שאפשר לדחוף לעמוד הראשון), עמודים לשיפור, תוכן/FAQ חסר, מקורות תנועה עם המרות נמוכות, וכו'. " +
      "החזר אך ורק JSON תקין במבנה: " +
      `{"tasks":[{"title":"כותרת קצרה ופעולתית","details":"הסבר קצר למה ואיך (1-2 משפטים)","priority":"high|medium|low"}]}. ` +
      "בין 5 ל-10 משימות. כתוב בעברית. אל תמציא נתונים שאינם בקלט.";

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
    const list: any[] = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
    if (list.length === 0) return jsonResponse({ created: 0, tasks: [] });

    const allowed = new Set(["high", "medium", "low"]);
    const rows = list.slice(0, 12).map((t, i) => ({
      client_id,
      title: String(t.title || "").slice(0, 300) || "משימה",
      details: t.details ? String(t.details).slice(0, 1000) : null,
      priority: allowed.has(t.priority) ? t.priority : null,
      source: "claude",
      status: "open",
      sort_order: i,
    }));

    const { data: inserted, error } = await sb.from("tasks").insert(rows).select();
    if (error) throw new Error(`insert failed: ${error.message}`);

    return jsonResponse({ created: inserted?.length || 0, tasks: inserted || [] });
  } catch (e) {
    console.error(e);
    return errorResponse((e as Error).message, 500);
  }
});
