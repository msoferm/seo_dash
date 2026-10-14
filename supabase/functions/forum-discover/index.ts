/**
 * POST { client_id, url, add? }
 * Fetches a forum INDEX page (e.g. a board with many sub-forums like prog.co.il) with a
 * browser User-Agent, extracts the sub-forum links, and returns them. If add=true, inserts
 * them as forum_sites (classified under the parent url) so each can be scanned on its own.
 * Returns { found: [{url,title}], added }.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember, serviceClient } from "../_shared/supabase.ts";
import { fetchHtml, extractSubforumLinks } from "../_shared/forum_html.ts";

function normUrl(u: string): string {
  return (u || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    await requireTeamMember(req);
    const { client_id, url, add } = await req.json();
    if (!client_id || !url) return errorResponse("חסר client_id או url", 400);

    const { status, html, finalUrl } = await fetchHtml(url);
    if (!html) {
      if (status === 403 || status === 401) return errorResponse(`האתר חוסם גישה אוטומטית (status ${status}).`, 502);
      return errorResponse(`לא ניתן למשוך את העמוד (status ${status}).`, 502);
    }
    const found = extractSubforumLinks(html, finalUrl).slice(0, 40);
    if (found.length === 0) return jsonResponse({ found: [], added: 0, note: "לא נמצאו תת-פורומים בעמוד הזה." });

    let added = 0;
    if (add) {
      const sb = serviceClient();
      const { data: existing } = await sb.from("forum_sites").select("url").eq("client_id", client_id);
      const have = new Set((existing || []).map((r: any) => normUrl(r.url)));
      const rows = found
        .filter((f) => !have.has(normUrl(f.url)))
        .map((f) => ({ client_id, url: f.url, name: f.title?.slice(0, 200) || null, parent_url: url, active: true }));
      if (rows.length) {
        const { error, data } = await sb.from("forum_sites").insert(rows).select("id");
        if (error) return errorResponse(`שגיאה בהוספה: ${error.message}`, 500);
        added = data?.length || rows.length;
      }
    }
    return jsonResponse({ found, added });
  } catch (e) {
    return errorResponse(`שגיאה בגילוי תת-פורומים: ${(e as Error).message}`, 500);
  }
});
