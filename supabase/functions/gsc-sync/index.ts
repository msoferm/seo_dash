/**
 * POST { client_id: number, days?: number }
 * Fetch latest GSC data and replace the local snapshot.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { getValidAccessToken, gscQuery } from "../_shared/google.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, days = 90 } = await req.json();
    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);
    if (!client.google_token_json) return errorResponse("הלקוח לא מחובר ל-Google", 400);
    if (!client.gsc_property) return errorResponse("חסר gsc_property בלקוח (לדוגמה: sc-domain:example.com)", 400);

    const { token, updatedJson } = await getValidAccessToken(client.google_token_json);
    if (updatedJson !== client.google_token_json) {
      await sb.from("clients").update({ google_token_json: updatedJson }).eq("id", client_id);
    }
    const rows = await gscQuery(token, client.gsc_property, days);

    // Replace existing
    await sb.from("gsc_metrics").delete().eq("client_id", client_id);
    if (rows.length > 0) {
      const inserts = rows.map((r) => ({
        client_id,
        term: r.term,
        page: r.page,
        date: r.date,
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        ctr: r.ctr || 0,
        position: r.position || 0,
      }));
      // Insert in chunks of 500
      for (let i = 0; i < inserts.length; i += 500) {
        await sb.from("gsc_metrics").insert(inserts.slice(i, i + 500));
      }
    }
    return jsonResponse({ synced: rows.length, days });
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
