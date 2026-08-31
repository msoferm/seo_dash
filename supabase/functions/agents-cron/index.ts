/**
 * Scheduled runner (called weekly by pg_cron via pg_net — no user session).
 * Auth: shared secret header `x-cron-secret`. Deployed with --no-verify-jwt.
 *
 * Returns immediately and does the work in a BACKGROUND task (EdgeRuntime.waitUntil),
 * processing ONE client per invocation and chaining to the next — this keeps every
 * request well under the 150s response window while still covering all clients.
 * Body: { index?: number } — the cron fires it with no body (index 0).
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { prospectForClient } from "../_shared/prospector.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const secret = Deno.env.get("CRON_SECRET");
    if (!secret || req.headers.get("x-cron-secret") !== secret) return errorResponse("unauthorized", 401);
    const { index = 0 } = await req.json().catch(() => ({}));

    const work = (async () => {
      const sb = serviceClient();
      const { data: clients } = await sb.from("clients").select("id, name").order("id");
      const list = clients || [];
      if (index >= list.length) return;
      try {
        await prospectForClient(sb, list[index].id);
      } catch (e) {
        console.error(`prospector failed for client ${list[index].id}:`, (e as Error).message);
      }
      if (index + 1 < list.length) {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/agents-cron`, {
          method: "POST",
          headers: { "x-cron-secret": secret, "Content-Type": "application/json" },
          body: JSON.stringify({ index: index + 1 }),
        }).catch(() => {});
      }
    })();

    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
    else await work;

    return jsonResponse({ started: true, index });
  } catch (e) {
    return errorResponse(`cron error: ${(e as Error).message}`, 500);
  }
});
