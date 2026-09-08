/**
 * POST { rec_id, modification? }
 * Applies a recommendation:
 *  - page-edit types (title_meta / improve_page / add_keywords) → edit the live WordPress
 *    page (reversible via revisions).
 *  - new_content → create a blog proposal for the keyword (flows into the Blog tab).
 *  - cannibalization / internal_link / other → mark done (needs manual/multi-page work).
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { applyPageFix } from "../_shared/wpfix.ts";

const PAGE_EDIT = new Set(["title_meta", "improve_page", "add_keywords"]);

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { rec_id, modification } = await req.json();
    if (!rec_id) return errorResponse("חסר rec_id", 400);
    const { data: r } = await sb.from("recommendations").select("*").eq("id", rec_id).maybeSingle();
    if (!r) return errorResponse("ההמלצה לא נמצאה", 404);

    if (PAGE_EDIT.has(r.type)) {
      if (!r.page) return errorResponse("אין עמוד יעד להמלצה זו", 400);
      const { data: cw } = await sb.from("client_wordpress").select("*").eq("client_id", r.client_id).maybeSingle();
      if (!cw) return errorResponse("חבר WordPress כדי לבצע את התיקון", 400);
      const instruction = [r.action, r.example ? `דוגמה מאושרת ליישום: ${r.example}` : "", modification ? `הנחיה נוספת: ${modification}` : ""].filter(Boolean).join("\n");
      const res = await applyPageFix(cw, r.page, instruction);
      await sb.from("recommendations").update({ status: "applied", applied_note: res.note, applied_at: new Date().toISOString() }).eq("id", rec_id);
      return jsonResponse({ applied: res.applied, note: res.note });
    }

    if (r.type === "new_content") {
      await sb.from("blog_posts").insert({ client_id: r.client_id, keyword: r.keyword, title: `הצעת מאמר: ${r.keyword}`, reason: `מהמלצות: ${r.opportunity}`, status: "proposed" });
      const note = "נוצרה הצעת מאמר בטאב 'בלוג אוטומטי' — אשר שם כדי לכתוב ולפרסם.";
      await sb.from("recommendations").update({ status: "done", applied_note: note, applied_at: new Date().toISOString() }).eq("id", rec_id);
      return jsonResponse({ applied: true, note });
    }

    // cannibalization / internal_link / performance_drop → manual
    const note = "סומן כבוצע — פעולה זו דורשת החלטה ידנית/רב-עמודית.";
    await sb.from("recommendations").update({ status: "done", applied_note: note, applied_at: new Date().toISOString() }).eq("id", rec_id);
    return jsonResponse({ applied: true, note });
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
