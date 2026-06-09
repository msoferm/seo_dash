/**
 * POST { page_id: number, additional_info: string }
 * Re-write existing FAQs using newly supplied business info.
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
    const { page_id, additional_info } = await req.json();
    const { data: page } = await sb.from("pages").select("*").eq("id", page_id).maybeSingle();
    if (!page) return errorResponse("עמוד לא נמצא", 404);
    const { data: client } = await sb.from("clients").select("*").eq("id", page.client_id).maybeSingle();
    const { data: existing } = await sb.from("faq_items").select("*").eq("page_id", page_id).order("order");
    if (!existing || existing.length === 0) return errorResponse("אין FAQ קיים. צור קודם.", 400);

    const userText = `שכתב את ה-FAQ הקיים תוך שילוב המידע החדש שסופק.

לקוח: ${client.name}
עמוד: ${page.url}

FAQ קיים:
${JSON.stringify(existing.map((f: any) => ({ kind: f.kind, question: f.question, answer: f.answer, order: f.order })), null, 2)}

מידע חדש שסופק:
${additional_info}

החזר JSON זהה במבנה אבל עם תשובות משופרות. שמור על אותו order ו-kind.
{ "items": [{"kind":..., "question":..., "answer":..., "order":...}] }`;

    const resp = await callClaude({
      model: DEFAULT_MODEL,
      max_tokens: 3000,
      system: SYSTEM_FAQ,
      messages: [{ role: "user", content: userText }],
    });
    const raw = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    let data: any;
    try { data = JSON.parse(stripJsonFence(raw)); } catch {
      return errorResponse("שכתוב נכשל - לא הצלחתי לפענח את התגובה", 500);
    }
    const items = data.items || [];
    for (const newItem of items) {
      const old = existing.find((e: any) => e.order === newItem.order);
      if (old) {
        await sb.from("faq_items").update({
          question: newItem.question,
          answer: newItem.answer,
        }).eq("id", old.id);
      }
    }
    return jsonResponse({ updated: items.length });
  } catch (e) {
    console.error(e);
    return errorResponse((e as Error).message, 500);
  }
});
