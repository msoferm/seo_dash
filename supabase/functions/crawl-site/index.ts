/**
 * POST { client_id: number, url?: string }
 * Crawl the site's sitemap.xml (or fallback to homepage) and upsert into `pages`.
 * Returns the full list of pages for the client.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";

const UA = "SEO-Dashboard/1.0";

function normalizeBase(domain: string): string {
  let d = domain.trim();
  if (!/^https?:\/\//i.test(d)) d = "https://" + d;
  return d.replace(/\/+$/, "");
}

async function fetchText(url: string, timeoutMs = 15000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal, redirect: "follow" });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function extractLocs(xml: string): { urls: string[]; sitemaps: string[] } {
  const urls: string[] = [];
  const sitemaps: string[] = [];
  // Cheap XML parsing via regex (sitemaps are well-formed enough)
  const urlMatches = xml.matchAll(/<url>[\s\S]*?<loc>([^<]+)<\/loc>/g);
  for (const m of urlMatches) urls.push(m[1].trim());
  const sitemapMatches = xml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>/g);
  for (const m of sitemapMatches) sitemaps.push(m[1].trim());
  return { urls, sitemaps };
}

async function discoverUrls(base: string): Promise<string[]> {
  const found = new Set<string>();
  const candidates = new Set<string>([`${base}/sitemap.xml`, `${base}/sitemap_index.xml`]);

  // robots.txt
  const robots = await fetchText(`${base}/robots.txt`);
  if (robots) {
    for (const line of robots.split("\n")) {
      const m = /^sitemap:\s*(.+)$/i.exec(line.trim());
      if (m) candidates.add(m[1].trim());
    }
  }

  const seen = new Set<string>();
  const queue = [...candidates];
  while (queue.length > 0) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    const xml = await fetchText(sm);
    if (!xml) continue;
    const { urls, sitemaps } = extractLocs(xml);
    for (const u of urls) found.add(u);
    for (const s of sitemaps) queue.push(s);
  }

  // Fallback: scrape homepage links
  if (found.size === 0) {
    const html = await fetchText(base);
    if (html) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (doc) {
        const baseHost = new URL(base).hostname;
        for (const a of doc.querySelectorAll("a[href]")) {
          const href = (a as Element).getAttribute("href");
          if (!href) continue;
          try {
            const abs = new URL(href, base);
            if (abs.hostname === baseHost) found.add(abs.toString().split("#")[0]);
          } catch { /* ignore */ }
        }
      }
    }
  }

  return [...found];
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, url } = await req.json();
    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);
    const base = normalizeBase(url || client.domain);
    const urls = await discoverUrls(base);
    if (urls.length === 0) return errorResponse("לא נמצאו עמודים. בדוק שה-sitemap זמין.", 400);

    // Upsert
    const rows = urls.slice(0, 500).map((u) => ({ client_id, url: u }));
    await sb.from("pages").upsert(rows, { onConflict: "client_id,url", ignoreDuplicates: true });
    const { data: all } = await sb.from("pages").select("*").eq("client_id", client_id).order("url");
    return jsonResponse(all || []);
  } catch (e) {
    console.error(e);
    return errorResponse((e as Error).message, 500);
  }
});
