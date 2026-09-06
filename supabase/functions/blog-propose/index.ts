/**
 * POST { client_id }  — semi-auto step 1: propose a topic + rationale (no article yet).
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { proposeForClient } from "../_shared/blogger.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);
    const result = await proposeForClient(sb, client_id);
    return jsonResponse(result);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
