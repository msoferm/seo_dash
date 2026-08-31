/**
 * POST { client_id }
 * Research agent: uses web search to find LEGITIMATE (white-hat) link-building
 * opportunities for the client — directories, guest-post blogs, relevant forums,
 * local citations, unlinked brand mentions. Inserts new ones into link_prospects.
 * It never posts anything — proposals only, for human review.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaudeAgent, DEFAULT_MODEL, WEB_TOOLS, textOf, extractJson } from "../_shared/anthropic.ts";

const VALID_TYPES = ["directory", "blog", "forum", "mention", "local", "other"];

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);

    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);

    const [kwRes, linksRes, prospectsRes] = await Promise.all([
      sb.from("keywords").select("term").eq("client_id", client_id).order("monthly_searches", { ascending: false }).limit(15),
      sb.from("report_links").select("url").eq("client_id", client_id),
      sb.from("link_prospects").select("url").eq("client_id", client_id),
    ]);
    const keywords = (kwRes.data || []).map((k: any) => k.term);
    const existing = new Set<string>([...(linksRes.data || []), ...(prospectsRes.data || [])].map((r: any) => normUrl(r.url)));

    const system =
      "אתה מומחה קידום אורגני (SEO) המתמחה בבניית קישורים לבנה (white-hat) בלבד. " +
      "מצא הזדמנויות קישור לגיטימיות ואיכותיות עבור העסק, על בסיס חיפוש אמיתי באינטרנט. " +
      "התמקד ב: (directory) אינדקסים/דירקטוריות עסקים ומקומיים רלוונטיים; (blog) בלוגים/אתרים בתחום עם עמוד 'כתבו לנו'/'guest post'/'write for us'; (forum) פורומים וקהילות שבהם הנושא נדון; (local) ציטוטים מקומיים (Google Business, מפות, אתרי אזור); (mention) אזכורי מותג קיימים ללא קישור. " +
      "אל תציע: רכישת קישורים ספאמית, רשתות PBN, אתרים לא רלוונטיים, או כל דבר שמפר את הנחיות גוגל. " +
      "לכל הזדמנות דרג עדיפות (score 0-100) לפי רלוונטיות, סמכות ומאמץ. אם מצאת עמוד קשר/אימייל — כלול אותו. " +
      "אחרי המחקר, החזר אך ורק JSON במבנה: " +
      `{"prospects":[{"type":"directory|blog|forum|mention|local|other","url":"https://...","title":"שם האתר/העמוד","reason":"למה רלוונטי (משפט)","suggested_action":"איך משיגים את הקישור (משפט)","contact":"אימייל/עמוד קשר או null","score":0}]}. ` +
      "החזר בין 8 ל-15 הזדמנויות. כתוב בעברית (למעט כתובות).";

    const userMsg =
      `עסק: ${client.name}\nדומיין: ${client.domain}\nתחום/הערות: ${client.notes || "לא צוין"}\n` +
      `מילות מפתח מרכזיות: ${keywords.join(", ") || "—"}\n\n` +
      `חפש באינטרנט הזדמנויות קישור רלוונטיות לעסק הזה (העדף מקורות בעברית/ישראליים אם רלוונטי). ` +
      `אל תכלול כתובות שכבר קיימות אצלנו: ${[...existing].slice(0, 40).join(", ") || "(אין)"}.`;

    const resp = await callClaudeAgent({
      model: DEFAULT_MODEL,
      max_tokens: 4500,
      system,
      messages: [{ role: "user", content: userMsg }],
      tools: WEB_TOOLS,
    });

    let parsed: any;
    try {
      parsed = extractJson(textOf(resp));
    } catch {
      return errorResponse("הסוכן לא החזיר תוצאות שניתן לפענח. נסה שוב.", 502);
    }
    const list: any[] = Array.isArray(parsed) ? parsed : (parsed.prospects || []);

    const seen = new Set(existing);
    const rows: any[] = [];
    for (const p of list) {
      const url = String(p.url || "").trim();
      if (!/^https?:\/\//i.test(url)) continue;
      const key = normUrl(url);
      if (seen.has(key)) continue;
      seen.add(key);
      const type = VALID_TYPES.includes(p.type) ? p.type : "other";
      rows.push({
        client_id,
        type,
        url,
        title: (p.title || "").toString().slice(0, 300) || null,
        reason: (p.reason || "").toString().slice(0, 1000) || null,
        suggested_action: (p.suggested_action || "").toString().slice(0, 1000) || null,
        contact: p.contact && p.contact !== "null" ? String(p.contact).slice(0, 300) : null,
        score: Math.max(0, Math.min(100, parseInt(p.score) || 0)),
        status: "new",
      });
    }

    if (rows.length > 0) {
      const { error } = await sb.from("link_prospects").insert(rows);
      if (error) throw new Error(`insert failed: ${error.message}`);
    }

    return jsonResponse({ created: rows.length });
  } catch (e) {
    return errorResponse(`שגיאה בסוכן איתור הקישורים: ${(e as Error).message}`, 500);
  }
});

function normUrl(u: string): string {
  return (u || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}
