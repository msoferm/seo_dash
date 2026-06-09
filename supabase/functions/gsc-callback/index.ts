/**
 * GET ?code=...&state=...
 * Google redirects here after consent. Saves token to clients.google_token_json,
 * then redirects back to the frontend.
 */
import { handleCors, errorResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { exchangeCode } from "../_shared/google.ts";

const FRONTEND_URL = Deno.env.get("FRONTEND_URL") || "http://localhost:5173";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return errorResponse("חסר code או state", 400);

    const sb = serviceClient();
    const { data: stateRow } = await sb.from("oauth_states").select("client_id").eq("state", state).maybeSingle();
    if (!stateRow) return errorResponse("state לא תקין או פג תוקף", 400);
    const clientId = stateRow.client_id;

    const tokens = await exchangeCode(code);
    await sb.from("clients").update({ google_token_json: JSON.stringify(tokens) }).eq("id", clientId);
    await sb.from("oauth_states").delete().eq("state", state);

    return new Response(null, {
      status: 302,
      headers: { Location: `${FRONTEND_URL}/clients/${clientId}?connected=1` },
    });
  } catch (e) {
    return new Response(`OAuth error: ${(e as Error).message}`, { status: 500 });
  }
});
