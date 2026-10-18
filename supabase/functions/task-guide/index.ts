/**
 * POST { task_id }
 * For a "manual" subtask (speed/technical/UX/conversions guidance): Claude writes a concrete
 * step-by-step how-to, stores it on the task note, and marks the task done. Nothing touches
 * the live site — this is guidance for the team to execute.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL, textOf } from "../_shared/anthropic.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { task_id } = await req.json();
    if (!task_id) return errorResponse("חסר task_id", 400);

    const { data: task } = await sb.from("tasks").select("*").eq("id", task_id).maybeSingle();
    if (!task) return errorResponse("המשימה לא נמצאה", 404);
    const { data: client } = await sb.from("clients").select("name, domain, notes").eq("id", task.client_id).maybeSingle();

    const system =
      "אתה יועץ SEO מומחה. כתוב הנחיית ביצוע קונקרטית וקצרה למשימה שסופקה — 3 עד 6 צעדים מעשיים וברורים שהצוות יכול לבצע בפועל, כולל כלים/מדדים רלוונטיים היכן שמתאים. " +
      "בלי מבוא ובלי סיכום — רק הצעדים. כתוב בעברית, קצר ולעניין.";
    const userMsg =
      `עסק: ${client?.name || ""} (${client?.domain || ""})\nהערות: ${client?.notes || "אין"}\n\n` +
      `משימה: ${task.title}\n${task.details ? `פירוט: ${task.details}` : ""}`;

    const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: userMsg }] });
    const note = textOf(resp).trim().slice(0, 2000) || "לא נוצרה הנחיה.";

    await sb.from("tasks").update({ note, status: "done", done_at: new Date().toISOString() }).eq("id", task_id);
    return jsonResponse({ note });
  } catch (e) {
    return errorResponse(`שגיאה בהפקת הנחיה: ${(e as Error).message}`, 500);
  }
});
