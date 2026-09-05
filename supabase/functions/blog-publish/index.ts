/**
 * POST { client_id }  (user-triggered "write & publish now")
 * Generates an SEO article from the client's opportunities and publishes it to their
 * WordPress. Returns the result.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { publishForClient } from "../_shared/blogger.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);
    const result = await publishForClient(sb, client_id);
    return jsonResponse(result);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
