/**
 * "סרוק את כל דפי האתר". POST { client_id } → { scan_id }.
 * Finds every published page (WordPress REST when connected, otherwise the sitemap), reads the
 * full text of each page from the live site (falling back to the WordPress content when the
 * site blocks direct reads), and stores it on `pages` (content_text, text_scanned_at, scan_error).
 * Progress + per-page issues are written to `site_scans`; runs in the background, UI polls.
 * Read-only towards the site — it never changes anything there.
 * rev: 2026-11-12a
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember, serviceClient } from "../_shared/supabase.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

const UA = "Mozilla/5.0 (compatible; SEO-Dashboard/1.0; +site-scan)";
const MAX_PAGES = 400;
const TEXT_CAP = 20000;

function normalizeSite(u: string): string { let s = (u || "").trim().replace(/\/+$/, ""); if (!/^https?:\/\//i.test(s)) s = "https://" + s; return s; }
function stripTags(html: string): string { return (html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(); }
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

async function fetchWithTimeout(url: string, ms = 20000, headers: Record<string, string> = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { headers: { "User-Agent": UA, ...headers }, redirect: "follow", signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

type Cand = { url: string; title?: string; wpHtml?: string };

async function fromWordPress(cw: any): Promise<Cand[]> {
  const site = normalizeSite(cw.site_url);
  const auth = "Basic " + btoa(`${cw.username}:${cw.app_password}`);
  const out: Cand[] = [];
  for (const type of ["pages", "posts"]) {
    for (let page = 1; page <= 10; page++) {
      const r = await fetchWithTimeout(`${site}/wp-json/wp/v2/${type}?per_page=100&page=${page}&status=publish&context=edit&_fields=link,title,content`, 30000, { Authorization: auth });
      if (!r.ok) break;
      const arr = await r.json();
      if (!Array.isArray(arr) || !arr.length) break;
      for (const p of arr) out.push({ url: p.link, title: stripTags(p.title?.raw || ""), wpHtml: p.content?.raw || "" });
      if (arr.length < 100) break;
    }
  }
  return out;
}

async function fromSitemap(domain: string): Promise<Cand[]> {
  const base = normalizeSite(domain);
  const seen = new Set<string>(); const urls = new Set<string>();
  const queue = [`${base}/sitemap_index.xml`, `${base}/sitemap.xml`, `${base}/wp-sitemap.xml`];
  while (queue.length && seen.size < 40 && urls.size < MAX_PAGES) {
    const sm = queue.shift()!; if (seen.has(sm)) continue; seen.add(sm);
    try {
      const r = await fetchWithTimeout(sm, 15000);
      if (!r.ok) continue;
      const xml = await r.text();
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        const u = m[1].replace(/&amp;/g, "&");
        if (/\.xml(\?|$)/i.test(u)) queue.push(u);
        else if (!/\.(jpg|jpeg|png|gif|webp|svg|pdf)(\?|$)/i.test(u)) urls.add(u);
      }
    } catch { /* try next sitemap */ }
  }
  if (!urls.size) urls.add(base + "/");
  return [...urls].map((url) => ({ url }));
}

/** Live read of a page: title, meta, H1 and the main readable text (menus/footers removed). */
async function readLive(url: string): Promise<{ title: string; meta: string; h1: string; text: string; noindex: boolean; finalUrl: string } | { error: string }> {
  let r: Response;
  try { r = await fetchWithTimeout(url); } catch (e) { return { error: (e as Error).name === "AbortError" ? "תם הזמן (20 שניות)" : `שגיאת רשת: ${(e as Error).message.slice(0, 80)}` }; }
  if (!r.ok) return { error: `האתר החזיר שגיאה ${r.status}` };
  const html = await r.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return { error: "לא ניתן לפענח את ה-HTML" };
  const title = doc.querySelector("title")?.textContent?.trim() || "";
  const meta = doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || "";
  const robots = doc.querySelector('meta[name="robots"]')?.getAttribute("content") || "";
  const h1 = doc.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() || "";
  doc.querySelectorAll("script, style, noscript, svg, iframe, header, footer, nav, aside, form").forEach((el) => el.remove());
  const main = doc.querySelector("main") || doc.querySelector("article") || doc.querySelector(".entry-content") || doc.querySelector(".elementor") || doc.body;
  const text = (main?.textContent || "").replace(/\s+/g, " ").trim();
  return { title, meta, h1, text, noindex: /noindex/i.test(robots), finalUrl: r.url || url };
}

async function scan(sb: any, clientId: number, scanId: number) {
  const { data: client } = await sb.from("clients").select("domain").eq("id", clientId).maybeSingle();
  const { data: cw } = await sb.from("client_wordpress").select("*").eq("client_id", clientId).maybeSingle();
  let cands: Cand[] = [];
  let method = "sitemap";
  if (cw) { try { cands = await fromWordPress(cw); method = "wordpress"; } catch { /* fall back to the sitemap */ } }
  if (!cands.length) { cands = await fromSitemap(client?.domain || ""); method = "sitemap"; }
  // Dedupe and cap.
  const byUrl = new Map<string, Cand>();
  for (const c of cands) { const k = c.url.replace(/\/+$/, "").toLowerCase(); if (!byUrl.has(k)) byUrl.set(k, c); }
  const list = [...byUrl.values()].slice(0, MAX_PAGES);
  await sb.from("site_scans").update({ method, pages_total: list.length }).eq("id", scanId);

  const results: any[] = [];
  let ok = 0, failed = 0, idx = 0;
  const now = new Date().toISOString();
  const worker = async () => {
    while (idx < list.length) {
      const c = list[idx++];
      const live = await readLive(c.url);
      let title = c.title || "", meta = "", h1 = "", text = "", issue: string | null = null;
      if ("error" in live) {
        issue = live.error;
      } else {
        title = live.title || title; meta = live.meta; h1 = live.h1; text = live.text;
        if (live.noindex) issue = "העמוד מסומן noindex (גוגל לא אמור לאנדקס אותו)";
        else if (live.finalUrl.replace(/\/+$/, "") !== c.url.replace(/\/+$/, "")) issue = `מפנה לכתובת אחרת: ${decodeURIComponent(live.finalUrl).slice(0, 120)}`;
      }
      // Live text missing/too short (blocked or JS-rendered) → use the WordPress content if we have it.
      if (words(text) < 30 && c.wpHtml && words(stripTags(c.wpHtml)) >= 30) {
        text = stripTags(c.wpHtml);
        issue = issue ? `${issue} · נלקח התוכן מ-WordPress` : "קריאה ישירה החזירה מעט טקסט · נלקח התוכן מ-WordPress";
      }
      const good = words(text) >= 30;
      if (!good && !issue) issue = "כמעט אין טקסט בעמוד";
      if (good) ok++; else failed++;
      await sb.from("pages").upsert({
        client_id: clientId, url: c.url, title: title.slice(0, 500) || null, meta_description: meta.slice(0, 500) || null, h1: h1.slice(0, 300) || null,
        word_count: words(text), content_text: text.slice(0, TEXT_CAP) || null, text_scanned_at: now, scan_error: issue, last_crawled: now, last_full_crawl: now,
      }, { onConflict: "client_id,url" });
      results.push({ url: c.url, title, words: words(text), ok: good, issue });
      if (results.length % 5 === 0) await sb.from("site_scans").update({ pages_ok: ok, pages_failed: failed, pages: results }).eq("id", scanId);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  await sb.from("site_scans").update({ status: "done", finished_at: new Date().toISOString(), pages_ok: ok, pages_failed: failed, pages: results }).eq("id", scanId);
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    await requireTeamMember(req);
    const { client_id } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);
    const sb = serviceClient();
    const { data: row, error } = await sb.from("site_scans").insert({ client_id, status: "running" }).select("id").single();
    if (error) throw error;
    const work = scan(sb, client_id, row.id).catch(async (e) => {
      console.error("scan failed:", (e as Error).message);
      await sb.from("site_scans").update({ status: "failed", finished_at: new Date().toISOString(), error: (e as Error).message.slice(0, 300) }).eq("id", row.id);
    });
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
    else await work;
    return jsonResponse({ scan_id: row.id });
  } catch (e) {
    return errorResponse(`שגיאה בסריקה: ${(e as Error).message}`, 500);
  }
});
