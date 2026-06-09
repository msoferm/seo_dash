import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/** Service-role client (bypasses RLS) - use for trusted server-side operations. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** User-context client - respects RLS via the caller's JWT. */
export function userClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get("Authorization") || "";
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
}

/** Verify the caller is a team member; return the user or throw. */
export async function requireTeamMember(req: Request) {
  const sb = userClient(req);
  const { data: { user }, error } = await sb.auth.getUser();
  if (error || !user) throw new Error("לא מאומת");
  const { data: tm } = await sb
    .from("team_members")
    .select("user_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!tm) throw new Error("המשתמש לא חבר בצוות. בקש מהאדמין להוסיף אותך.");
  return { user, role: tm.role, sb };
}
