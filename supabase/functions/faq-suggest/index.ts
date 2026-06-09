/**
 * POST { page_id: number }
 * Suggest 5-8 additional FAQ items based on long-tail search queries from GSC or keywords.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL } from "../_shared/anthropic.ts";
import { SYSTEM_FAQ, stripJsonFence } from "../_shared/faq_prompts.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { page_id } = await req.json();
    const { data: page } = await sb.from("pages").select("*").eq("id", page_id).maybeSingle();
    if (!page) return errorResponse("עמוד לא נמצא", 404);
    const { data: client } = await sb.from("clients").select("*").eq("id", page.client_id).maybeSingle();

    // Try GSC queries for this specific page first
    const { data: gscRows } = await sb
      .from("gsc_metrics")
      .select("term, impressions")
      .eq("client_id", client.id)
      .eq("page", page.url)
      .not("term", "is", null);
    const agg = new Map<string, number>();
    for (const r of gscRows || []) {
      agg.set(r.term, (agg.get(r.term) || 0) + (r.impressions || 0));
    }
    let queries = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t]) => t);

    if (queries.length === 0) {
      const { data: kws } = await sb
        .from("keywords")
        .select("term")
        .eq("client_id", client.id)
        .order("monthly_searches", { ascending: false })
        .limit(30);
      queries = (kws || []).map((k: any) => k.term);
    }
    if (queries.length === 0) {
      return errorResponse("אין שאילתות חיפוש זמינות. סנכרן GSC או העלה CSV של מילות מפתח.", 400);
    }

    const userText = `על בסיס שאילתות חיפוש אמיתיות של גולשים, הצע 5-8 שאלות-תשובות נוספות לעמוד.

לקוח: ${client.name}
עמוד: ${page.url}
כותרת: ${page.title || "לא זמין"}

שאילתות גולשים:
${queries.map((q) => `- ${q}`).join("\n")}

החזר JSON:
{ "items": [{"question":..., "answer":..., "based_on_query": "השאילתה שהובילה לשאלה"}] }`;

    const resp = await callClaude({
      model: DEFAULT_MODEL,
      max_tokens: 2500,
      system: SYSTEM_FAQ,
      messages: [{ role: "user", content: userText }],
    });
    const raw = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    let data: any;
    try { data = JSON.parse(stripJsonFence(raw)); } catch {
      return jsonResponse({ suggestions: [] });
    }
    return jsonResponse({ suggestions: data.items || [], based_on_query_count: queries.length });
  } catch (e) {
    console.error(e);
    return errorResponse((e as Error).message, 500);
  }
});
