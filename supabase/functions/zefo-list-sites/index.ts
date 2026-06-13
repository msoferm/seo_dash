/**
 * GET (or POST) — returns all ZEFO sites for the account, plus their current linkage to clients.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { listSites } from "../_shared/zefo.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const [zefoSites, { data: clients }] = await Promise.all([
      listSites(),
      sb.from("clients").select("id, name, zefo_site_id"),
    ]);
    const linked = new Map<number, { client_id: number; client_name: string }>();
    for (const c of clients || []) {
      if (c.zefo_site_id) linked.set(c.zefo_site_id, { client_id: c.id, client_name: c.name });
    }
    const sites = zefoSites.map((s) => ({
      ...s,
      linked_client: linked.get(s.id) || null,
    }));
    return jsonResponse({ sites });
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
