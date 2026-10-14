/**
 * Deterministic forum fetching + HTML parsing.
 * Many forums (prog.co.il, tapuz, fxp...) sit behind Cloudflare and return 403 to bot
 * user-agents — which is exactly what Anthropic's web_fetch hits. So we fetch the pages
 * ourselves with a real browser User-Agent and extract what we need in code, then hand the
 * clean text to Claude for relevance + reply drafting (no web tools needed).
 */

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

export async function fetchHtml(url: string): Promise<{ status: number; html: string; finalUrl: string }> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "he-IL,he;q=0.9,en;q=0.8" },
      redirect: "follow",
    });
    const html = r.ok ? await r.text() : "";
    return { status: r.status, html, finalUrl: r.url || url };
  } catch (e) {
    return { status: 0, html: "", finalUrl: url };
  }
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(+n); } catch { return _; } });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

/** Follow rel="next" (software-agnostic pagination). */
export function nextPageUrl(html: string, baseUrl: string): string | null {
  const m = html.match(/<(?:link|a)\b[^>]*\brel=["']?next["']?[^>]*\bhref=["']([^"']+)["']/i) ||
            html.match(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']?next["']?/i);
  if (!m) return null;
  try { return new URL(decodeEntities(m[1]), baseUrl).toString(); } catch { return null; }
}

const THREAD_RE = /\/threads\/|showthread|viewtopic|\/topic[\/=]|\/forum\/.*\.\d+|\bt=\d+/i;
const SUBFORUM_RE = /\/forums\/|forumdisplay|\/forumim\/|\/f=\d+/i;

interface Link { url: string; title: string }

function anchors(html: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out.push({ href: decodeEntities(m[1]), text: decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() });
  }
  return out;
}

// Last-post timestamps that XenForo/others render as a link to the same thread.
const DATE_LIKE = /^(לפני|היום|אתמול|\d{1,2}[\/.]\d{1,2}([\/.]\d{2,4})?|\d{1,2}:\d{2})/;

/** Thread/topic links on a forum listing page. Keeps the best (longest, non-date) title per thread. */
export function extractThreadLinks(html: string, baseUrl: string): Link[] {
  const best = new Map<string, { url: string; title: string }>();
  for (const a of anchors(html)) {
    if (!THREAD_RE.test(a.href)) continue;
    if (a.text.length < 5) continue;                 // skip reply counts / page numbers
    if (/^\d+$/.test(a.text)) continue;
    let abs: string;
    try { abs = new URL(a.href, baseUrl).toString().split("#")[0]; } catch { continue; }
    if (/\/page-\d+\/?$/.test(abs) || /[?&]page=\d+/.test(abs)) continue; // in-thread pagination
    if (/\/(latest|unread|post-\d+)\/?$/.test(abs)) continue;
    const key = abs.toLowerCase();
    const prev = best.get(key);
    // Prefer a real title: non-date beats date; otherwise the longer text wins.
    const aIsDate = DATE_LIKE.test(a.text);
    if (!prev) { best.set(key, { url: abs, title: a.text }); continue; }
    const prevIsDate = DATE_LIKE.test(prev.title);
    if ((prevIsDate && !aIsDate) || (prevIsDate === aIsDate && a.text.length > prev.title.length)) {
      best.set(key, { url: abs, title: a.text });
    }
  }
  return [...best.values()];
}

/** Sub-forum links on a forum index page (for auto-discovery). */
export function extractSubforumLinks(html: string, baseUrl: string): Link[] {
  const out: Link[] = []; const seen = new Set<string>();
  const base = (() => { try { return new URL(baseUrl); } catch { return null; } })();
  for (const a of anchors(html)) {
    if (!SUBFORUM_RE.test(a.href)) continue;
    if (a.text.length < 3) continue;
    let u: URL;
    try { u = new URL(a.href, baseUrl); } catch { continue; }
    if (base && u.host !== base.host) continue;
    const abs = u.toString().split("#")[0].replace(/\/+$/, "/") ;
    const key = abs.toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    if (base && abs.replace(/\/$/, "") === baseUrl.replace(/\/$/, "")) continue; // skip self
    out.push({ url: abs, title: a.title });
  }
  return out;
}

/** Best-effort extraction of the opening post (the question) from a thread page. */
export function extractFirstPost(html: string): string {
  // XenForo: .bbWrapper ; vBulletin: .content / [id^=post_message] ; generic: first <article>
  const patterns = [
    /class=["'][^"']*bbWrapper[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /id=["']post_message_\d+["'][^>]*>([\s\S]*?)<\/div>/i,
    /class=["'][^"']*message-body[^"']*["'][^>]*>([\s\S]*?)<\/article>/i,
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) { const t = htmlToText(m[1]); if (t.length > 40) return t.slice(0, 2500); }
  }
  // Fallback: og:description + a slice of body text.
  const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const text = htmlToText(html);
  return ((og ? decodeEntities(og[1]) + " " : "") + text).slice(0, 2500);
}
