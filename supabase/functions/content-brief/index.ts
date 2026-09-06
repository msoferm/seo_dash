/**
 * POST { client_id, keyword }
 * Builds a content brief for a target keyword — checks the live SERP (web search)
 * for intent and gaps, then returns a structured brief the writer can follow.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaudeAgent, DEFAULT_MODEL, WEB_TOOLS, textOf, extractJson } from "../_shared/anthropic.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, keyword } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);
    if (!keyword || !keyword.trim()) return errorResponse("חסרה מילת מפתח", 400);

    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);

    const system =
      "אתה אסטרטג תוכן SEO. עבור מילת המפתח, בדוק בחיפוש את התוצאות המובילות (SERP) כדי להבין כוונת חיפוש ופערים, " +
      "ואז הכן בריף תוכן מעשי לכותב. החזר אך ורק JSON: " +
      `{"suggested_title":"כותרת מוצעת","search_intent":"כוונת החיפוש (מידע/מסחרי/מקומי/ניווט)","outline":["H2/H3 מוצעים..."],"questions":["שאלות שהתוכן חייב לענות עליהן..."],"entities":["מונחים/ישויות לכלול..."],"internal_links":"רמז לקישורים פנימיים","word_count":"טווח אורך מומלץ","notes":"הערות/פערים מול המתחרים"}. ` +
      "כתוב בעברית. היה קונקרטי ומבוסס על מה שראית בתוצאות. קריטי: החזר אך ורק את אובייקט ה-JSON — התחל ישירות בתו { בלי שום טקסט, הקדמה או בלוק קוד לפניו או אחריו.";

    const userMsg =
      `עסק: ${client.name} (${client.domain}). הערות: ${client.notes || "—"}.\nמילת מפתח יעד: "${keyword.trim()}".\nהכן בריף תוכן.`;

    const resp = await callClaudeAgent({
      model: DEFAULT_MODEL,
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: userMsg }],
      tools: WEB_TOOLS,
    });

    const raw = textOf(resp);
    let b: any;
    try {
      b = extractJson(raw);
    } catch {
      return errorResponse(`לא ניתן היה לפענח את הבריף. פלט: ${raw.slice(0, 250)}`, 502);
    }
    return jsonResponse({
      keyword: keyword.trim(),
      suggested_title: String(b.suggested_title || ""),
      search_intent: String(b.search_intent || ""),
      outline: Array.isArray(b.outline) ? b.outline.map(String) : [],
      questions: Array.isArray(b.questions) ? b.questions.map(String) : [],
      entities: Array.isArray(b.entities) ? b.entities.map(String) : [],
      internal_links: String(b.internal_links || ""),
      word_count: String(b.word_count || ""),
      notes: String(b.notes || ""),
    });
  } catch (e) {
    return errorResponse(`שגיאה בהכנת הבריף: ${(e as Error).message}`, 500);
  }
});
