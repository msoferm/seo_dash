/**
 * POST { client_id, title, html, excerpt?, keyword?, image_query?, proposal_id? }
 * #1a: publish an article the team edited manually after "צור דוגמה" — exactly as given,
 * without regenerating it. Lets the user add their own text before publishing.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { publishEdited } from "../_shared/blogger.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, title, html, excerpt, keyword, image_query, proposal_id } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);
    if (!title || !html) return errorResponse("חסר כותרת או גוף המאמר", 400);
    const result = await publishEdited(sb, client_id, { title, html, excerpt, keyword, imageQuery: image_query, proposalId: proposal_id });
    return jsonResponse(result);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
