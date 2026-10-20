/**
 * POST { client_id, page_url, keyword }
 * Fetches the page (browser UA, bypasses bot blocks), then Claude evaluates:
 *  - relevance of the page to the target keyword,
 *  - whether it answers the query directly & early (Featured-Snippet readiness),
 *  - E-E-A-T signals (Experience, Expertise, Authoritativeness, Trust),
 *  and returns concrete fixes. Read-only — changes nothing on the site.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL, textOf, extractJson } from "../_shared/anthropic.ts";
import { fetchHtml, htmlToText } from "../_shared/forum_html.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, page_url, keyword } = await req.json();
    if (!client_id || !page_url || !keyword) return errorResponse("חסר עמוד או מילת מפתח", 400);

    const { data: client } = await sb.from("clients").select("name, domain, notes").eq("id", client_id).maybeSingle();

    const { status, html } = await fetchHtml(page_url);
    if (!html) return errorResponse(status === 403 || status === 401 ? `האתר חוסם גישה אוטומטית (status ${status}).` : `לא ניתן למשוך את העמוד (status ${status}).`, 502);

    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
    const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] || "").trim();
    const bodyText = htmlToText(html).slice(0, 8000);

    const system =
      "אתה מבקר SEO מומחה ל-E-E-A-T ולכוונת חיפוש. נתח את העמוד שסופק מול מילת המפתח. " +
      "החזר אך ורק JSON במבנה: " +
      '{"overall_score":0-100,' +
      '"relevance":{"score":0-100,"verdict":"משפט על עד כמה העמוד רלוונטי ועונה על כוונת החיפוש של מילת המפתח"},' +
      '"direct_answer":{"answers_directly":true/false,"early":true/false,"explanation":"האם התשובה לשאלה מופיעה ישירות ובמקום גבוה בעמוד (מוכנות ל-Featured Snippet)","suggested_snippet":"פסקת תשובה קצרה וממוקדת (40-60 מילים) שכדאי לשים בראש העמוד"},' +
      '"eeat":{"experience":{"score":0-100,"note":"..."},"expertise":{"score":0-100,"note":"..."},"authoritativeness":{"score":0-100,"note":"..."},"trust":{"score":0-100,"note":"..."}},' +
      '"fixes":["תיקון קונקרטי 1","תיקון קונקרטי 2"]}. ' +
      "התבסס רק על מה שבעמוד. כתוב בעברית. התחל ישירות ב-{.";
    const userMsg =
      `עסק: ${client?.name || ""} (${client?.domain || ""})\nהערות: ${client?.notes || "אין"}\n` +
      `מילת מפתח יעד: ${keyword}\nכתובת: ${page_url}\n\n` +
      `כותרת SEO: ${title || "(חסרה)"}\nH1: ${h1 || "(חסר)"}\nתיאור מטא: ${metaDesc || "(חסר)"}\n\nתוכן העמוד:\n${bodyText}`;

    const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 2500, system, messages: [{ role: "user", content: userMsg }] });
    let parsed: any; try { parsed = extractJson(textOf(resp)); } catch { return errorResponse(`לא התקבל ניתוח תקין: ${textOf(resp).slice(0, 200)}`, 502); }

    return jsonResponse({ page_url, keyword, title, h1, meta_description: metaDesc, ...parsed });
  } catch (e) {
    return errorResponse(`שגיאה בניתוח: ${(e as Error).message}`, 500);
  }
});
