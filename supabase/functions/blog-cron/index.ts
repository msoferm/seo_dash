/**
 * Weekly auto-blog runner (called by pg_cron via pg_net — no user session).
 * Auth: shared secret header `x-cron-secret`. Deployed with --no-verify-jwt.
 * Returns immediately; publishes ONE client per invocation and chains to the next in a
 * background task, staying under the 150s edge-function limit.
 * Body: { index?: number }.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { publishForClient } from "../_shared/blogger.ts";

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
      const { data: rows } = await sb.from("client_wordpress").select("client_id").eq("enabled", true).order("client_id");
      const list = rows || [];
      if (index >= list.length) return;
      try {
        await publishForClient(sb, list[index].client_id);
      } catch (e) {
        console.error(`blog publish failed for client ${list[index].client_id}:`, (e as Error).message);
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
