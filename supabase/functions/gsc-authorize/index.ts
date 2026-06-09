/**
 * POST { client_id: number }
 * Returns the Google OAuth consent URL. Stores state in oauth_states table.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { buildAuthUrl } from "../_shared/google.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    if (!Deno.env.get("GOOGLE_CLIENT_ID") || !Deno.env.get("GOOGLE_CLIENT_SECRET")) {
      return errorResponse("GOOGLE_CLIENT_ID/SECRET לא הוגדרו ב-Supabase secrets", 400);
    }
    const { client_id } = await req.json();
    const { data: client } = await sb.from("clients").select("id").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);
    const state = crypto.randomUUID();
    await sb.from("oauth_states").insert({ state, client_id });
    return jsonResponse({ auth_url: buildAuthUrl(state) });
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
