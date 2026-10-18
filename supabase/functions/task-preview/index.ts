/**
 * POST { task_id }
 * Preview BEFORE executing — read-only, changes nothing on the site:
 *  - writes_text tasks (new article / title+meta / content rewrite / FAQ) → Claude writes the
 *    actual draft text so the user can review what it will write.
 *  - other tasks → Claude writes detailed step-by-step instructions so the user understands
 *    exactly what to do.
 * Stores the result on tasks.preview and returns { mode, text }.
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

    // Pull extra context from the source recommendation when available.
    let recCtx = "";
    if (task.source_type === "recommendation" && task.source_ref) {
      const { data: rec } = await sb.from("recommendations").select("type, page, keyword, action, opportunity").eq("id", Number(task.source_ref)).maybeSingle();
      if (rec) recCtx = `סוג: ${rec.type}\n${rec.keyword ? `מילת מפתח: ${rec.keyword}\n` : ""}${rec.page ? `עמוד: ${rec.page}\n` : ""}${rec.opportunity ? `הזדמנות: ${rec.opportunity}\n` : ""}${rec.action ? `פעולה מומלצת: ${rec.action}\n` : ""}`;
    }

    const base = `עסק: ${client?.name || ""} (${client?.domain || ""})\nהערות על העסק: ${client?.notes || "אין"}\n\nמשימה: ${task.title}\n${task.details ? `פירוט: ${task.details}\n` : ""}${recCtx}`;

    let mode: "draft" | "guidance", system: string, maxTokens: number;
    if (task.writes_text) {
      mode = "draft";
      maxTokens = 4000;
      system =
        "אתה כותב תוכן SEO מקצועי. כתוב את הטקסט המוכן לביצוע עבור המשימה — טקסט אמיתי, מלא ומוגמר שאפשר לאשר ולהשתמש בו כמו שהוא (לא הסבר על מה לכתוב). " +
        "אם זו כתיבת מאמר — כתוב מאמר מלא עם כותרת, כותרות משנה ופסקאות. אם זו כותרת SEO ותיאור מטא — כתוב אותם במפורש (כותרת: ... / תיאור מטא: ...). אם זה שיפור/הוספת קטע — כתוב את הקטע המשופר במלואו. " +
        "אל תמציא עובדות על העסק שלא נמסרו. כתוב בעברית, מובנה וברור.";
    } else {
      mode = "guidance";
      maxTokens = 1800;
      system =
        "אתה יועץ SEO מומחה. פרט בדיוק איך לבצע את המשימה — רשימת צעדים ממוספרת, מפורטת ומעשית, כולל כלים רלוונטיים, מדדים לבדיקה, וקריטריון לסיום (Definition of Done). " +
        "היה קונקרטי כדי שהמבצע יבין בדיוק מה לעשות. כתוב בעברית.";
    }

    const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: base }] });
    const text = textOf(resp).trim().slice(0, 8000) || "לא נוצר תוכן.";

    await sb.from("tasks").update({ preview: text }).eq("id", task_id);
    return jsonResponse({ mode, text });
  } catch (e) {
    return errorResponse(`שגיאה בהפקת תצוגה מקדימה: ${(e as Error).message}`, 500);
  }
});
