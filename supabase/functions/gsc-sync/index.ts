/**
 * POST { client_id: number, days?: number, from?: string, to?: string }
 * Syncs GSC data for a window (explicit from/to, else last `days`):
 *  - gsc_daily_totals: authoritative daily clicks/impressions/position (date-only query)
 *  - gsc_metrics: query/page/date detail for the top-keywords & top-pages features
 * Only the synced date range is replaced, so syncing different periods accumulates.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { getValidAccessToken, gscQuery, gscDailyTotals, resolveRange } from "../_shared/google.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, days = 90, from, to } = await req.json();
    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);
    if (!client.google_token_json) return errorResponse("הלקוח לא מחובר ל-Google", 400);
    if (!client.gsc_property) return errorResponse("חסר gsc_property בלקוח (לדוגמה: sc-domain:example.com)", 400);

    const { token, updatedJson } = await getValidAccessToken(client.google_token_json);
    if (updatedJson !== client.google_token_json) {
      await sb.from("clients").update({ google_token_json: updatedJson }).eq("id", client_id);
    }

    const { startDate, endDate } = resolveRange(days, from, to);

    // 1) Accurate daily totals — replace only this range, then insert.
    const totals = await gscDailyTotals(token, client.gsc_property, startDate, endDate);
    await sb.from("gsc_daily_totals").delete().eq("client_id", client_id).gte("date", startDate).lte("date", endDate);
    const totalRows = totals
      .filter((t) => t.date)
      .map((t) => ({ client_id, date: t.date, clicks: t.clicks, impressions: t.impressions, position: t.position }));
    for (let i = 0; i < totalRows.length; i += 500) {
      const { error } = await sb.from("gsc_daily_totals").insert(totalRows.slice(i, i + 500));
      if (error) throw new Error(`daily_totals insert failed: ${error.message}`);
    }

    // 2) Query/page/date detail — replace only this range, then insert.
    const detail = await gscQuery(token, client.gsc_property, startDate, endDate);
    await sb.from("gsc_metrics").delete().eq("client_id", client_id).gte("date", startDate).lte("date", endDate);
    if (detail.length > 0) {
      const inserts = detail.map((r) => ({
        client_id, term: r.term, page: r.page, date: r.date,
        clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || 0,
      }));
      for (let i = 0; i < inserts.length; i += 500) {
        const { error } = await sb.from("gsc_metrics").insert(inserts.slice(i, i + 500));
        if (error) throw new Error(`gsc_metrics insert failed: ${error.message}`);
      }
    }

    return jsonResponse({ synced: detail.length, days_synced: totalRows.length, from: startDate, to: endDate });
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
