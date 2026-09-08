/**
 * POST { rec_id }
 * Generates a concrete example draft for a recommendation (title+meta, subheadings,
 * content structure, or outline) — NOT published. Stores it on the recommendation.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL, textOf } from "../_shared/anthropic.ts";

const ASK: Record<string, string> = {
  title_meta: "הצע כותרת SEO אחת (עד 60 תווים) ותיאור מטא אחד (120-155 תווים) שמדגישים את מילת המפתח, מזמינים ומדויקים.",
  improve_page: "הצע 3-5 כותרות משנה (H2/H3) חדשות, 3-4 שאלות שכדאי לענות עליהן, ורשימת מונחים/נושאים להוספה — כדי לחזק את העמוד סביב מילת המפתח.",
  add_keywords: "הסבר איזה מידע אמיתי חסר בעמוד עבור מילת המפתח, וכיצד לשלב אותו בצורה טבעית (כותרת משנה + פסקה לדוגמה).",
  new_content: "הצע מבנה מאמר/עמוד חדש למילת המפתח: כותרת, כוונת חיפוש, שלד כותרות (H2/H3), שאלות לענות עליהן, ואורך מומלץ.",
  cannibalization: "הצע כיצד לפתור: איזה עמוד לקבוע כראשי, מה למקד בכל עמוד, ואילו קישורים פנימיים/הפניות לבצע.",
};

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { rec_id } = await req.json();
    if (!rec_id) return errorResponse("חסר rec_id", 400);
    const { data: r } = await sb.from("recommendations").select("*").eq("id", rec_id).maybeSingle();
    if (!r) return errorResponse("ההמלצה לא נמצאה", 404);
    const { data: client } = await sb.from("clients").select("name, domain, notes").eq("id", r.client_id).maybeSingle();

    const system = "אתה מומחה SEO. הכן דוגמה קונקרטית ומעשית להמלצה, בעברית, קצרה וברורה, בלי מרקדאון מיותר. זו טיוטה בלבד — אל תפרסם.";
    const userMsg =
      `עסק: ${client?.name} (${client?.domain}). ${client?.notes ? "הערות: " + client.notes + ". " : ""}\n` +
      `מילת מפתח: "${r.keyword || "—"}". עמוד: ${r.page || "(חדש)"}.\n` +
      `ההזדמנות: ${r.opportunity}\nמה חסר: ${r.whats_missing}\nהפעולה: ${r.action}\n\n` +
      (ASK[r.type] || "הכן דוגמה מעשית ליישום ההמלצה.");

    const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 1500, system, messages: [{ role: "user", content: userMsg }] });
    const example = textOf(resp).trim();
    if (!example) return errorResponse("לא נוצרה דוגמה. נסה שוב.", 502);
    await sb.from("recommendations").update({ example }).eq("id", rec_id);
    return jsonResponse({ example });
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
