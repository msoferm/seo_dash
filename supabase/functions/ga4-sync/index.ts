/**
 * POST { client_id: number, days?: number }
 * Pulls daily organic-only metrics from GA4 + top organic landing pages,
 * persists to ga4_metrics table (replacing the window).
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { getValidAccessToken } from "../_shared/google.ts";

async function runReport(accessToken: string, propertyId: string, body: any): Promise<any> {
  const r = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) throw new Error(`GA4 API ${r.status}: ${await r.text()}`);
  return await r.json();
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, days = 30 } = await req.json();
    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);
    if (!client.google_token_json) return errorResponse("הלקוח לא מחובר ל-Google", 400);
    if (!client.ga4_property_id) return errorResponse("חסר ga4_property_id בלקוח (אפשר לערוך מהלקוח)", 400);

    const { token, updatedJson } = await getValidAccessToken(client.google_token_json);
    if (updatedJson !== client.google_token_json) {
      await sb.from("clients").update({ google_token_json: updatedJson }).eq("id", client_id);
    }

    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    const dateRange = { startDate: ymd(start), endDate: ymd(end) };

    // Report 1: daily organic - by date + landing page
    const dailyByPage = await runReport(token, client.ga4_property_id, {
      dimensions: [
        { name: "date" },
        { name: "landingPagePlusQueryString" },
        { name: "sessionSource" },
        { name: "sessionMedium" },
      ],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "engagedSessions" },
        { name: "conversions" },
      ],
      dateRanges: [dateRange],
      limit: 50000,
    });

    // Replace window
    await sb.from("ga4_metrics").delete().eq("client_id", client_id);

    const rows: any[] = [];
    for (const row of dailyByPage.rows || []) {
      const dv = row.dimensionValues;
      const mv = row.metricValues;
      const medium = dv[3]?.value || "";
      if (medium !== "organic") continue; // organic only
      const dateRaw = dv[0]?.value || ""; // YYYYMMDD
      const date = dateRaw.length === 8
        ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
        : dateRaw;
      rows.push({
        client_id,
        date,
        page_path: dv[1]?.value || null,
        sessions: parseInt(mv[0]?.value || "0"),
        total_users: parseInt(mv[1]?.value || "0"),
        engaged_sessions: parseInt(mv[2]?.value || "0"),
        conversions: parseInt(mv[3]?.value || "0"),
        session_source: dv[2]?.value || null,
        session_medium: medium,
      });
    }

    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await sb.from("ga4_metrics").insert(chunk);
      if (error) throw new Error(`insert failed: ${error.message}`);
    }
    return jsonResponse({ synced: rows.length, days });
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
