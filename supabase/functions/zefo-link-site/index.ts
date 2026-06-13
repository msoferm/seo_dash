/**
 * POST { client_id: number, zefo_site_id: number | null }
 * Sets the client's zefo_site_id (or clears it).
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, zefo_site_id } = await req.json();
    const { error } = await sb.from("clients").update({ zefo_site_id: zefo_site_id || null }).eq("id", client_id);
    if (error) return errorResponse(error.message, 500);
    return jsonResponse({ ok: true });
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
