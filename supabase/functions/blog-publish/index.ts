/**
 * POST { client_id }  (user-triggered "write & publish now")
 * Generates an SEO article from the client's opportunities and publishes it to their
 * WordPress. Returns the result.
 * rev: 2026-10-29a (dry-run returns full article body; manual publish decoupled from weekly enable flag)
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { publishForClient, writeAndPublish } from "../_shared/blogger.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, dry_run, keyword, sources, modification, internal_links } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);
    // dry_run → generate a sample draft WITHOUT publishing (returns { title, body, preview }).
    if (dry_run) {
      const result = keyword
        ? await writeAndPublish(sb, client_id, keyword, { dryRun: true, sources, modification, internalLinks: internal_links })
        : await publishForClient(sb, client_id, { dryRun: true });
      return jsonResponse(result);
    }
    const result = await publishForClient(sb, client_id);
    return jsonResponse(result);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
