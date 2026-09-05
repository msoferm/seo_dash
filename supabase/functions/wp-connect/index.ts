/**
 * POST { client_id, site_url, username, app_password, mode?, enabled? }
 * Tests the WordPress connection (GET /users/me with the Application Password) and,
 * if valid, saves it. Never stores credentials that don't authenticate.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";

function normalizeSite(u: string): string {
  let s = (u || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, site_url, username, app_password, mode = "publish", enabled = true } = await req.json();
    if (!client_id || !site_url || !username || !app_password) return errorResponse("חסרים פרטי חיבור", 400);
    const site = normalizeSite(site_url);
    const auth = "Basic " + btoa(`${username}:${app_password}`);

    // Verify credentials + edit capability
    let res: Response;
    try {
      res = await fetch(`${site}/wp-json/wp/v2/users/me?context=edit`, { headers: { Authorization: auth } });
    } catch {
      return errorResponse(`לא ניתן להגיע לאתר ${site} — בדוק את הכתובת`, 400);
    }
    if (res.status === 401 || res.status === 403) return errorResponse("שם משתמש או סיסמת יישום שגויים", 400);
    if (!res.ok) return errorResponse(`חיבור ל-WordPress נכשל (${res.status}) — ודא שה-REST API פעיל`, 400);
    const me = await res.json().catch(() => ({}));

    const { error } = await sb.from("client_wordpress").upsert(
      { client_id, site_url: site, username, app_password, mode, enabled },
      { onConflict: "client_id" },
    );
    if (error) throw new Error(error.message);

    return jsonResponse({ ok: true, wp_user: me.name || username, site });
  } catch (e) {
    return errorResponse(`שגיאה בחיבור WordPress: ${(e as Error).message}`, 500);
  }
});
