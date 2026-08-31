/**
 * POST { prospect_id }
 * Drafts outreach for a single link prospect, tailored to its type:
 *  - blog  → guest-post pitch email
 *  - mention → request to turn an unlinked mention into a link
 *  - directory/local → a listing description to submit
 *  - forum → a helpful contribution suggestion
 * Returns { subject, body }. The team sends it from their own inbox (approval-first).
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL, textOf, extractJson } from "../_shared/anthropic.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { prospect_id } = await req.json();
    if (!prospect_id) return errorResponse("חסר prospect_id", 400);

    const { data: p } = await sb.from("link_prospects").select("*").eq("id", prospect_id).maybeSingle();
    if (!p) return errorResponse("ההזדמנות לא נמצאה", 404);
    const { data: client } = await sb.from("clients").select("*").eq("id", p.client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);

    const kind: Record<string, string> = {
      blog: "מייל פנייה קצר ומנומס להצעת אורח (guest post): מי אנחנו, למה התוכן רלוונטי לקהל שלהם, ו-2-3 רעיונות לנושאים.",
      mention: "מייל קצר ומנומס המבקש להפוך אזכור קיים של העסק לקישור (הם כבר הזכירו אותנו — נחמד לבקש קרדיט/קישור).",
      directory: "טקסט תיאור עסק להגשה לאינדקס/דירקטורי — תיאור שיווקי קצר, מדויק, עם מילות מפתח טבעיות.",
      local: "טקסט תיאור לרישום מקומי (Google Business/מפות/אתר אזורי) — קצר, מקומי ומזמין.",
      forum: "הצעת תגובה/תרומה מועילה לדיון בפורום, שמשלבת קישור באופן טבעי ולא ספאמי (רק אם באמת תורם).",
      other: "פנייה קצרה ומנומסת המתאימה להזדמנות.",
    };

    const system =
      "אתה כותב פניות קידום מקצועיות בעברית, בטון אנושי, קצר ומנומס — לא ספאמי. " +
      "בהינתן פרטי העסק וההזדמנות, כתוב את הטקסט המבוקש. " +
      "אם זה מייל — תן גם שורת נושא. אחרת השאר subject ריק. " +
      "החזר אך ורק JSON: {\"subject\":\"...\",\"body\":\"...\"}.";

    const userMsg =
      `עסק: ${client.name} (${client.domain})\nהערות: ${client.notes || "—"}\n\n` +
      `סוג ההזדמנות: ${p.type}\nאתר יעד: ${p.title || p.url} (${p.url})\n` +
      `רקע: ${p.reason || "—"}\nפעולה מוצעת: ${p.suggested_action || "—"}\n\n` +
      `כתוב: ${kind[p.type] || kind.other}`;

    const resp = await callClaude({
      model: DEFAULT_MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: userMsg }],
    });

    let parsed: any;
    try {
      parsed = extractJson(textOf(resp));
    } catch {
      return errorResponse("לא ניתן היה לפענח את הטיוטה. נסה שוב.", 502);
    }
    return jsonResponse({ subject: String(parsed.subject || "").trim(), body: String(parsed.body || "").trim() });
  } catch (e) {
    return errorResponse(`שגיאה בהכנת הפנייה: ${(e as Error).message}`, 500);
  }
});
