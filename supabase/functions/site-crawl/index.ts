/**
 * POST { client_id }
 * Full structured crawl for WordPress clients — pulls every page & post via the
 * authenticated WP REST API (no WAF/bot issue), extracts on-page SEO fields and the
 * internal-link graph, and stores them in `pages` + `page_links`.
 * Runs in the background (EdgeRuntime.waitUntil); the UI polls last_full_crawl.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember, serviceClient } from "../_shared/supabase.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

function normalizeSite(u: string): string { let s = (u || "").trim().replace(/\/+$/, ""); if (!/^https?:\/\//i.test(s)) s = "https://" + s; return s; }
function basicAuth(user: string, pass: string): string { return "Basic " + btoa(`${user}:${pass}`); }
function stripTags(html: string): string { return (html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(); }
function firstH1(html: string): string | null { const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); return m ? stripTags(m[1]).slice(0, 300) : null; }
function countTags(html: string, tags: string[]): number { let n = 0; for (const t of tags) n += (html.match(new RegExp(`<${t}[\\s>]`, "gi")) || []).length; return n; }
function imageStats(html: string): { total: number; missing: number } { const imgs = html.match(/<img[^>]*>/gi) || []; let missing = 0; for (const im of imgs) if (!/\balt\s*=\s*["'][^"']+["']/i.test(im)) missing++; return { total: imgs.length, missing }; }
function hasSchema(html: string): boolean { return /application\/ld\+json/i.test(html); }

function classifyType(url: string, wpType: string): string {
  const p = decodeURIComponent(url).toLowerCase();
  if (/(שירות|service)/.test(p)) return "service";
  if (/(מאמר|בלוג|article|blog|post)/.test(p) || wpType === "posts") return "article";
  if (/(מוצר|product|חנות|shop)/.test(p)) return "product";
  if (/(קטגורי|category|תגית|tag)/.test(p)) return "category";
  if (/(אודות|about|צור-קשר|contact)/.test(p)) return "about";
  return wpType === "posts" ? "article" : "page";
}

async function crawl(sb: any, clientId: number) {
  const { data: cw } = await sb.from("client_wordpress").select("*").eq("client_id", clientId).maybeSingle();
  if (!cw) throw new Error("not connected");
  const site = normalizeSite(cw.site_url);
  const host = site.replace(/^https?:\/\//, "");
  const auth = basicAuth(cw.username, cw.app_password);

  const links: any[] = [];
  const pageRows: any[] = [];
  const now = new Date().toISOString();

  for (const type of ["pages", "posts"] as const) {
    for (let page = 1; page <= 10; page++) {
      const r = await fetch(`${site}/wp-json/wp/v2/${type}?per_page=100&page=${page}&context=edit&_fields=id,link,status,slug,title,content,excerpt`, { headers: { Authorization: auth } });
      if (!r.ok) break;
      const arr = await r.json();
      if (!Array.isArray(arr) || arr.length === 0) break;
      for (const p of arr) {
        const url = p.link;
        const html = p.content?.raw || "";
        const img = imageStats(html);
        // internal links
        const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let mm: RegExpExecArray | null; let outCount = 0;
        while ((mm = re.exec(html))) {
          let href = mm[1];
          if (href.startsWith("/")) href = site + href;
          if (!href.includes(host)) continue;
          if (/\.(jpg|jpeg|png|gif|webp|pdf|zip|svg)(\?|$)/i.test(href)) continue;
          outCount++;
          links.push({ client_id: clientId, from_url: url, to_url: href.split("#")[0].replace(/\/+$/, ""), anchor: stripTags(mm[2]).slice(0, 120) });
        }
        pageRows.push({
          client_id: clientId, url,
          title: stripTags(p.title?.raw || "").slice(0, 500) || null,
          status: p.status, wp_id: p.id, wp_type: type,
          meta_description: stripTags(p.excerpt?.raw || "").slice(0, 500) || null,
          h1: firstH1(html), subheadings: countTags(html, ["h2", "h3"]),
          word_count: stripTags(html).split(" ").filter(Boolean).length,
          page_type: classifyType(url, type),
          images_total: img.total, images_missing_alt: img.missing,
          internal_links_out: outCount,
          last_crawled: now, last_full_crawl: now,
        });
      }
      if (arr.length < 100) break;
    }
  }

  // upsert pages
  for (let i = 0; i < pageRows.length; i += 100) {
    await sb.from("pages").upsert(pageRows.slice(i, i + 100), { onConflict: "client_id,url" });
  }
  // rebuild internal-link graph
  await sb.from("page_links").delete().eq("client_id", clientId);
  for (let i = 0; i < links.length; i += 500) {
    await sb.from("page_links").insert(links.slice(i, i + 500));
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    await requireTeamMember(req);
    const { client_id } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);
    const { data: cw } = await serviceClient().from("client_wordpress").select("client_id").eq("client_id", client_id).maybeSingle();
    if (!cw) return errorResponse("סריקה אוטומטית זמינה ללקוחות המחוברים ל-WordPress", 400);

    const work = crawl(serviceClient(), client_id).catch((e) => console.error("crawl failed:", (e as Error).message));
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
    else await work;
    return jsonResponse({ started: true });
  } catch (e) {
    return errorResponse(`שגיאה בסריקה: ${(e as Error).message}`, 500);
  }
});
