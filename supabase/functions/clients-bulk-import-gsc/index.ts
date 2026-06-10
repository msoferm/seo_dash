/**
 * POST { source_client_id: number, properties: string[] }
 * For each GSC property URL, create a new client copying the Google token from
 * the source client. The new clients can immediately sync GSC.
 *
 * Skips properties that already exist as a client's gsc_property (idempotent).
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";

function deriveDomain(siteUrl: string): string {
  if (siteUrl.startsWith("sc-domain:")) return siteUrl.substring("sc-domain:".length);
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return siteUrl;
  }
}

function deriveName(siteUrl: string): string {
  const domain = deriveDomain(siteUrl);
  return domain.replace(/^www\./, "");
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { source_client_id, properties } = await req.json();
    if (!source_client_id || !Array.isArray(properties) || properties.length === 0) {
      return errorResponse("חסר source_client_id או properties", 400);
    }
    const { data: source } = await sb.from("clients").select("google_token_json").eq("id", source_client_id).maybeSingle();
    if (!source) return errorResponse("לקוח מקור לא נמצא", 404);
    if (!source.google_token_json) return errorResponse("ללקוח המקור אין חיבור Google", 400);

    const { data: existing } = await sb.from("clients").select("gsc_property");
    const taken = new Set((existing || []).map((r: any) => r.gsc_property).filter(Boolean));

    const created: any[] = [];
    const skipped: string[] = [];
    for (const siteUrl of properties) {
      if (taken.has(siteUrl)) {
        skipped.push(siteUrl);
        continue;
      }
      const { data: newClient, error } = await sb
        .from("clients")
        .insert({
          name: deriveName(siteUrl),
          domain: deriveDomain(siteUrl),
          gsc_property: siteUrl,
          google_token_json: source.google_token_json,
        })
        .select("id, name, domain, gsc_property")
        .single();
      if (error) {
        skipped.push(siteUrl);
        continue;
      }
      created.push(newClient);
      taken.add(siteUrl);
    }
    return jsonResponse({ created, skipped, created_count: created.length, skipped_count: skipped.length });
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
