/**
 * POST { client_id }  (user-triggered)
 * Runs the research agent for one client. Core logic + learning live in
 * _shared/prospector.ts (also used by the weekly cron). Proposals only — never posts.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { prospectForClient } from "../_shared/prospector.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);
    const created = await prospectForClient(sb, client_id);
    return jsonResponse({ created });
  } catch (e) {
    return errorResponse(`שגיאה בסוכן איתור הקישורים: ${(e as Error).message}`, 500);
  }
});
