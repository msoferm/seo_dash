/**
 * POST { client_id: number, days?: number }
 * Returns organic traffic summary for the client.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { getValidAccessToken, ga4Report } from "../_shared/google.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, days = 30 } = await req.json();
    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);
    if (!client.google_token_json) return errorResponse("הלקוח לא מחובר ל-Google", 400);
    if (!client.ga4_property_id) return errorResponse("חסר ga4_property_id בלקוח", 400);

    const { token, updatedJson } = await getValidAccessToken(client.google_token_json);
    if (updatedJson !== client.google_token_json) {
      await sb.from("clients").update({ google_token_json: updatedJson }).eq("id", client_id);
    }
    const report = await ga4Report(token, client.ga4_property_id, days);

    let organicSessions = 0;
    let organicUsers = 0;
    for (const row of report.rows || []) {
      const medium = row.dimensionValues[1]?.value || "";
      if (medium === "organic") {
        organicSessions += parseInt(row.metricValues[0]?.value || "0");
        organicUsers += parseInt(row.metricValues[1]?.value || "0");
      }
    }
    return jsonResponse({ organic_sessions: organicSessions, organic_users: organicUsers, days });
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
