/**
 * POST { proposal_id }  — semi-auto step 2: write & publish the approved topic.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { approveProposal } from "../_shared/blogger.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { proposal_id } = await req.json();
    if (!proposal_id) return errorResponse("חסר proposal_id", 400);
    const result = await approveProposal(sb, proposal_id);
    return jsonResponse(result);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
