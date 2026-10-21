/**
 * POST { item_id, instructions? }
 * Returns an improved client-facing { title, why } draft for a report item (does NOT save —
 * the user reviews and applies). Optional instructions steer the rewrite.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL, textOf, extractJson } from "../_shared/anthropic.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { item_id, instructions } = await req.json();
    if (!item_id) return errorResponse("חסר item_id", 400);

    const { data: item } = await sb.from("report_items").select("*").eq("id", item_id).maybeSingle();
    if (!item) return errorResponse("הפריט לא נמצא", 404);
    const { data: client } = await sb.from("clients").select("name, domain, notes").eq("id", item.client_id).maybeSingle();

    const system =
      "אתה משפר ניסוח של פריט בדוח קידום ללקוח. שפר את הכותרת וההסבר כך שיהיו ברורים, מקצועיים וחיוביים ללקוח — " +
      "ההסבר צריך לומר למה הפעולה בוצעה ואיך היא תורמת לקידום/לעסק, בשפה ללקוח (לא טכנית מדי). " +
      'החזר אך ורק JSON: {"title":"...","why":"..."}. התחל ישירות ב-{.';
    const userMsg =
      `עסק: ${client?.name || ""} (${client?.domain || ""}). ${client?.notes ? `רקע: ${client.notes}` : ""}\n\n` +
      `כותרת נוכחית: ${item.title}\nהסבר נוכחי: ${item.why || "(ריק)"}${item.page_url ? `\nעמוד: ${item.page_url}` : ""}` +
      (instructions && String(instructions).trim() ? `\n\nהנחיות לשיפור: ${String(instructions).trim()}` : "");

    const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 800, system, messages: [{ role: "user", content: userMsg }] });
    let p: any; try { p = extractJson(textOf(resp)); } catch { return errorResponse("לא התקבלה תשובה תקינה", 502); }

    return jsonResponse({ title: String(p.title || item.title).slice(0, 300), why: String(p.why || "").slice(0, 1000) });
  } catch (e) {
    return errorResponse(`שגיאה בשיפור ההסבר: ${(e as Error).message}`, 500);
  }
});
