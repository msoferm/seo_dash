/**
 * POST { client_id: number }
 * Lists the Google Search Console properties available to the client's connected Google account.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { getValidAccessToken } from "../_shared/google.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id } = await req.json();
    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);
    if (!client.google_token_json) return errorResponse("הלקוח לא מחובר ל-Google", 400);

    const { token, updatedJson } = await getValidAccessToken(client.google_token_json);
    if (updatedJson !== client.google_token_json) {
      await sb.from("clients").update({ google_token_json: updatedJson }).eq("id", client_id);
    }

    const r = await fetch("https://searchconsole.googleapis.com/webmasters/v3/sites", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      const txt = await r.text();
      return errorResponse(`GSC sites.list ${r.status}: ${txt}`, 500);
    }
    const data = await r.json();
    const sites = (data.siteEntry || []).map((s: any) => ({
      site_url: s.siteUrl,
      permission_level: s.permissionLevel,
    }));
    return jsonResponse({ sites });
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
