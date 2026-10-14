/**
 * POST { client_id }            → scan all active forums for the client (chained in background)
 * POST { client_id, queue:[id] } → internal: scan queue[0] then chain to the rest
 *
 * Each forum is scanned in its own background invocation and the next one is triggered by a
 * self-call, so one forum's web_fetch work never blocks another and we stay well under the
 * per-request time limit. The UI polls forum_leads for results.
 *
 * Internal chained calls authenticate with the service-role key (x-internal header);
 * the first (user) call is authorized via requireTeamMember.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember, serviceClient } from "../_shared/supabase.ts";
import { scanForumSite } from "../_shared/forum_scanner.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

const MAX_FORUMS_PER_RUN = 8; // safety cap

function selfInvoke(body: unknown) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/forum-scan`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, "apikey": key, "x-internal": "1" },
    body: JSON.stringify(body),
  }).catch((e) => console.error("forum-scan chain failed:", (e as Error).message));
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const isInternal = req.headers.get("x-internal") === "1" &&
      (req.headers.get("Authorization") || "") === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
    if (!isInternal) await requireTeamMember(req); // authorize the user-triggered call

    const { client_id, queue } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);

    const sb = serviceClient();

    // Build the queue on the first (non-internal) call: stalest active forums first.
    let ids: number[];
    if (Array.isArray(queue)) {
      ids = queue;
    } else {
      const { data: sites } = await sb.from("forum_sites").select("id")
        .eq("client_id", client_id).eq("active", true)
        .order("last_scanned_at", { ascending: true, nullsFirst: true });
      ids = (sites || []).map((s: any) => s.id).slice(0, MAX_FORUMS_PER_RUN);
    }
    if (ids.length === 0) return jsonResponse({ started: false, remaining: 0, note: "אין פורומים פעילים לסריקה" });

    const [head, ...rest] = ids;
    const work = (async () => {
      try { await scanForumSite(sb, head); }
      catch (e) { console.error(`scanForumSite(${head}) failed:`, (e as Error).message); }
      if (rest.length) await selfInvoke({ client_id, queue: rest });
    })();

    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
    else await work;

    return jsonResponse({ started: true, remaining: ids.length });
  } catch (e) {
    return errorResponse(`שגיאה בסריקת פורומים: ${(e as Error).message}`, 500);
  }
});
