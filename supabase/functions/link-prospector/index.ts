/**
 * POST { client_id }  (user-triggered)
 * The web-search agent can take longer than the 150s response window, so we run it as
 * a BACKGROUND task (EdgeRuntime.waitUntil) and return immediately. The UI polls the
 * prospects list for the new rows. Core logic + learning live in _shared/prospector.ts.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember, serviceClient } from "../_shared/supabase.ts";
import { prospectForClient } from "../_shared/prospector.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    await requireTeamMember(req); // authorize the caller
    const { client_id } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);

    // Run under service role in the background so the request can return right away.
    const work = prospectForClient(serviceClient(), client_id).catch((e) => {
      console.error("prospector failed:", (e as Error).message);
    });
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
    else await work;

    return jsonResponse({ started: true });
  } catch (e) {
    return errorResponse(`שגיאה בסוכן איתור הקישורים: ${(e as Error).message}`, 500);
  }
});
