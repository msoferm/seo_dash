/**
 * POST { client_id: number }
 * Lists GA4 properties accessible to the client's connected Google account.
 * Returns [{ property_id, display_name, parent_account }].
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

    // List all GA4 account summaries (returns properties grouped by account)
    const r = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      const body = await r.text();
      if (r.status === 403) {
        return errorResponse(
          "ה-API של Analytics Admin לא מופעל בפרויקט Google Cloud. הפעל את 'Google Analytics Admin API' ב-Google Cloud Console.",
          403,
        );
      }
      return errorResponse(`GA4 admin ${r.status}: ${body}`, 500);
    }
    const data = await r.json();
    const properties: any[] = [];
    for (const acc of data.accountSummaries || []) {
      for (const p of acc.propertySummaries || []) {
        // property name is like "properties/123456789"
        const propertyId = p.property?.split("/").pop();
        properties.push({
          property_id: propertyId,
          display_name: p.displayName,
          parent_account: acc.displayName,
        });
      }
    }
    return jsonResponse({ properties });
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
