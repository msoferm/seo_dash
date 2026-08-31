/**
 * Scheduled runner (called by pg_cron via pg_net — no user session).
 * Authenticated with a shared secret header `x-cron-secret`. Runs the link-prospecting
 * agent for every client. Deployed with --no-verify-jwt so cron can reach it.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { prospectForClient } from "../_shared/prospector.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const expected = Deno.env.get("CRON_SECRET");
    if (!expected || req.headers.get("x-cron-secret") !== expected) {
      return errorResponse("unauthorized", 401);
    }
    const sb = serviceClient();
    const { data: clients } = await sb.from("clients").select("id, name");
    const list = clients || [];

    // Run clients in parallel so the whole job fits in one function invocation.
    const settled = await Promise.allSettled(list.map((c: any) => prospectForClient(sb, c.id)));
    const results = settled.map((s, i) => ({
      client_id: list[i].id,
      name: list[i].name,
      created: s.status === "fulfilled" ? s.value : 0,
      error: s.status === "rejected" ? String((s.reason as Error)?.message || s.reason) : undefined,
    }));
    const total = results.reduce((n, r) => n + (r.created || 0), 0);
    return jsonResponse({ ran: list.length, total_created: total, results });
  } catch (e) {
    return errorResponse(`cron error: ${(e as Error).message}`, 500);
  }
});
