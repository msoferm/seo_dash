/**
 * Weekly auto-blog runner (called by pg_cron via pg_net — no user session).
 * Auth: shared secret header `x-cron-secret`. Deployed with --no-verify-jwt.
 * Returns immediately; publishes ONE client per invocation and chains to the next in a
 * background task, staying under the 150s edge-function limit.
 * Body: { index?: number }.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { publishForClient, proposeForClient } from "../_shared/blogger.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const secret = Deno.env.get("CRON_SECRET");
    if (!secret || req.headers.get("x-cron-secret") !== secret) return errorResponse("unauthorized", 401);
    const body = await req.json().catch(() => ({}));
    const { index = 0 } = body;

    // Diagnostic: generate a real proposal for one client.
    if (body.propose && body.client_id) {
      try {
        const r = await proposeForClient(serviceClient(), body.client_id);
        return jsonResponse({ propose: true, ...r });
      } catch (e) {
        return jsonResponse({ propose: true, error: String((e as Error)?.message || e) });
      }
    }

    // Diagnostic: dry-run article generation (no publish) for one client.
    if (body.debug && body.client_id) {
      try {
        const r = await publishForClient(serviceClient(), body.client_id, { dryRun: true });
        return jsonResponse({ debug: true, ...r });
      } catch (e) {
        return jsonResponse({ debug: true, error: String((e as Error)?.message || e) });
      }
    }

    const work = (async () => {
      const sb = serviceClient();
      const { data: rows } = await sb.from("client_wordpress").select("client_id, require_approval").eq("enabled", true).order("client_id");
      const list = rows || [];
      if (index >= list.length) return;
      const c = list[index];
      try {
        // Semi-auto clients get a proposal (awaiting approval); full-auto clients publish.
        if (c.require_approval) await proposeForClient(sb, c.client_id);
        else await publishForClient(sb, c.client_id);
      } catch (e) {
        console.error(`blog job failed for client ${c.client_id}:`, (e as Error).message);
      }
      if (index + 1 < list.length) {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/blog-cron`, {
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
    return errorResponse(`blog-cron error: ${(e as Error).message}`, 500);
  }
});
