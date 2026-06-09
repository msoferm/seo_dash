/**
 * POST { page_id: number }
 * Fetch the page's HTML, extract title + text excerpt, update the row.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";

const UA = "SEO-Dashboard/1.0";
const MAX_CHARS = 8000;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { page_id } = await req.json();
    const { data: page } = await sb.from("pages").select("*").eq("id", page_id).maybeSingle();
    if (!page) return errorResponse("עמוד לא נמצא", 404);

    let title = page.title || "";
    let excerpt = "";
    try {
      const r = await fetch(page.url, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (r.ok) {
        const html = await r.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        if (doc) {
          title = doc.querySelector("title")?.textContent?.trim() || title;
          // Strip scripts/styles
          doc.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
          const text = (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
          excerpt = text.slice(0, MAX_CHARS);
        }
      } else {
        excerpt = `[HTTP ${r.status}]`;
      }
    } catch (e) {
      excerpt = `[שגיאה: ${(e as Error).message}]`;
    }

    const { data: updated } = await sb
      .from("pages")
      .update({ title, content_excerpt: excerpt, last_crawled: new Date().toISOString() })
      .eq("id", page_id)
      .select()
      .single();
    return jsonResponse(updated);
  } catch (e) {
    console.error(e);
    return errorResponse((e as Error).message, 500);
  }
});
