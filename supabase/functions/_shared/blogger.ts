/**
 * Core auto-blog logic (shared by the manual trigger and the weekly cron).
 * Topic is chosen from GSC opportunities + ZEFO rank data (high-volume, improvable,
 * not recently used). The article follows the per-client blog_instructions (continuous
 * improvement). Publishes to WordPress with a featured image (Pexels, optional) and
 * SEO title + meta description.
 */
import { callClaude, DEFAULT_MODEL, textOf } from "./anthropic.ts";

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function normalizeSite(u: string): string {
  let s = (u || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}
function basicAuth(user: string, pass: string): string { return "Basic " + btoa(`${user}:${pass}`); }

export interface PublishResult { title: string; url: string; status: string; keyword: string; image?: boolean; preview?: string }

export async function publishForClient(sb: any, clientId: number, opts: { dryRun?: boolean } = {}): Promise<PublishResult> {
  const { data: client } = await sb.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (!client) throw new Error("לקוח לא נמצא");
  const { data: cw } = await sb.from("client_wordpress").select("*").eq("client_id", clientId).maybeSingle();
  if (!opts.dryRun) {
    if (!cw) throw new Error("הלקוח לא מחובר ל-WordPress");
    if (!cw.enabled) throw new Error("הבלוג האוטומטי כבוי ללקוח זה");
  }

  const to = ymd(new Date());
  const from = ymd(new Date(Date.now() - 90 * 86400000));
  const [{ data: opps }, { data: recent }, { data: zefo }, { data: kw }] = await Promise.all([
    sb.rpc("gsc_query_opportunities", { p_client_id: clientId, p_from: from, p_to: to }),
    sb.from("blog_posts").select("keyword").eq("client_id", clientId).order("created_at", { ascending: false }).limit(40),
    sb.from("zefo_keywords").select("keyword, ranking, initial_ranking, best_rank, local_searches, difficulty").eq("client_id", clientId).order("local_searches", { ascending: false, nullsFirst: false }).limit(60),
    sb.from("keywords").select("term, monthly_searches").eq("client_id", clientId).order("monthly_searches", { ascending: false }).limit(40),
  ]);
  const used = new Set((recent || []).map((r: any) => (r.keyword || "").trim()).filter(Boolean));

  // ----- topic selection: blend GSC opportunities + ZEFO volume/position -----
  type Cand = { term: string; score: number };
  const cands: Cand[] = [];
  for (const o of (opps || []) as any[]) {
    if (o.position >= 6 && o.position <= 40 && o.impressions >= 15) cands.push({ term: o.term, score: o.impressions * 2 });
  }
  for (const z of (zefo || []) as any[]) {
    const vol = z.local_searches || 0;
    if (vol < 10) continue;
    // bonus for improvable positions (there's demand but not yet #1-3), and easier keywords
    const posBonus = z.ranking && z.ranking >= 4 && z.ranking <= 30 ? 1.6 : 1;
    const diffPenalty = z.difficulty && z.difficulty > 60 ? 0.6 : 1;
    cands.push({ term: z.keyword, score: vol * posBonus * diffPenalty });
  }
  for (const k of (kw || []) as any[]) cands.push({ term: k.term, score: (k.monthly_searches || 0) * 0.5 });

  const byTerm = new Map<string, number>();
  for (const c of cands) {
    const t = (c.term || "").trim();
    if (!t || used.has(t)) continue;
    byTerm.set(t, Math.max(byTerm.get(t) || 0, c.score));
  }
  const keyword = [...byTerm.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!keyword) throw new Error("אין נושא זמין למאמר — הוסף מילות מפתח / סנכרן GSC ו-ZEFO");

  // ----- context for the writer: related tracked keywords + client's ranking landscape -----
  const relatedZefo = ((zefo || []) as any[])
    .filter((z) => z.keyword && z.keyword !== keyword && (z.local_searches || 0) > 0)
    .slice(0, 15)
    .map((z) => `${z.keyword}${z.local_searches ? ` (${z.local_searches} חיפושים${z.ranking ? `, מיקום ${z.ranking}` : ""})` : ""}`);

  const instructions = (cw?.blog_instructions || "").trim();

  const system =
    "אתה כותב תוכן SEO מקצועי בעברית לבלוג עסקי, במסגרת תהליך שיפור מתמיד. " +
    "כתוב מאמר איכותי, מקורי, מועיל וקריא סביב מילת המפתח — כותרת (H1) מושכת וממוקדת-SEO, מבנה עם כותרות H2/H3, פסקאות, ורשימות היכן שמתאים. 600-900 מילים. " +
    "שלב את מילת המפתח באופן טבעי בכותרת, בפתיחה ובכותרות המשנה (בלי ספאם), ושזור מונחים קשורים מהרשימה שסופקה כדי לחזק את הרלוונטיות הסמנטית. " +
    "אל תמציא עובדות, מספרים, מחירים או פרטים ספציפיים שאינך יכול לאמת. " +
    (instructions ? `הנחיות חובה של הצוות ללקוח זה (כבד אותן תמיד): ${instructions}\n` : "") +
    "החזר בפורמט המדויק הבא ובלי שום טקסט נוסף:\n" +
    "TITLE: <כותרת ה-SEO בשורה אחת, עד 60 תווים, כוללת את מילת המפתח>\n" +
    "EXCERPT: <תיאור מטא לקידום אורגני בשורה אחת, 120-155 תווים, מזמין וכולל את מילת המפתח>\n" +
    "IMAGE: <2-4 מילות חיפוש באנגלית לתמונה ראשית מתאימה>\n" +
    "BODY:\n<גוף המאמר ב-HTML בלבד — h2/h3/p/ul, בלי <html>/<body> ובלי לחזור על ה-H1>";

  const userMsg =
    `עסק: ${client.name} (דומיין: ${client.domain}).\nהערות על העסק: ${client.notes || "—"}.\n` +
    `מילת מפתח יעד: "${keyword}".\n` +
    (relatedZefo.length ? `מילות מפתח קשורות במעקב (ZEFO) לשזירה טבעית: ${relatedZefo.join(" | ")}.\n` : "") +
    `כתוב מאמר בלוג שיווקי-מקצועי סביב מילת המפתח.`;

  const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: userMsg }] });
  const text = textOf(resp);
  const title = (text.match(/TITLE:\s*(.+)/)?.[1] || "").trim();
  const excerpt = (text.match(/EXCERPT:\s*(.+)/)?.[1] || "").trim();
  const imageQuery = (text.match(/IMAGE:\s*(.+)/)?.[1] || "").trim();
  let html = (text.match(/BODY:\s*([\s\S]+)$/)?.[1] || "").trim();
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
  if (!title || html.length < 40) throw new Error(`המאמר שנוצר לא תקין. פלט גולמי: ${text.slice(0, 300)}`);

  if (opts.dryRun) {
    return { title, url: "(dry-run)", status: "dry", keyword, image: !!imageQuery, preview: `[image: ${imageQuery}] ` + html.slice(0, 350) };
  }

  const site = normalizeSite(cw.site_url);
  const auth = basicAuth(cw.username, cw.app_password);

  // ----- featured image (Pexels, optional) -----
  let featuredMedia: number | null = null;
  try {
    const img = await fetchPexels(imageQuery || keyword);
    if (img) featuredMedia = await uploadMedia(site, auth, img);
  } catch { /* image is best-effort */ }

  // ----- create the post -----
  const postBody: any = { title, content: html, excerpt, status: cw.mode };
  if (featuredMedia) postBody.featured_media = featuredMedia;
  let res: Response;
  try {
    res = await fetch(`${site}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(postBody),
    });
  } catch (e) {
    await recordError(sb, clientId, title, keyword, `שגיאת רשת ל-WordPress: ${(e as Error).message}`);
    throw new Error(`לא ניתן להגיע ל-WordPress בכתובת ${site}`);
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    await recordError(sb, clientId, title, keyword, `WordPress ${res.status}: ${body}`);
    throw new Error(`WordPress דחה את הבקשה (${res.status}). בדוק כתובת/שם משתמש/סיסמת יישום.`);
  }
  const post = await res.json();

  // ----- best-effort SEO plugin meta (Yoast / RankMath) — never fail the publish -----
  try {
    await fetch(`${site}/wp-json/wp/v2/posts/${post.id}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ meta: {
        _yoast_wpseo_title: title, _yoast_wpseo_metadesc: excerpt,
        rank_math_title: title, rank_math_description: excerpt,
      } }),
    });
  } catch { /* meta plugin may not accept REST — excerpt already serves as fallback */ }

  await sb.from("blog_posts").insert({ client_id: clientId, title, keyword, wp_post_id: post.id, url: post.link, status: post.status });
  await sb.from("client_wordpress").update({ last_published_at: new Date().toISOString() }).eq("client_id", clientId);

  return { title, url: post.link, status: post.status, keyword, image: !!featuredMedia };
}

async function fetchPexels(query: string): Promise<{ bytes: Uint8Array; filename: string; contentType: string } | null> {
  const key = Deno.env.get("PEXELS_API_KEY");
  if (!key || !query) return null;
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`, { headers: { Authorization: key } });
  if (!r.ok) return null;
  const d = await r.json();
  const url = d.photos?.[0]?.src?.large || d.photos?.[0]?.src?.original;
  if (!url) return null;
  const ir = await fetch(url);
  if (!ir.ok) return null;
  return {
    bytes: new Uint8Array(await ir.arrayBuffer()),
    filename: (query.replace(/[^a-z0-9]+/gi, "-").slice(0, 40) || "featured") + ".jpg",
    contentType: "image/jpeg",
  };
}

async function uploadMedia(site: string, auth: string, img: { bytes: Uint8Array; filename: string; contentType: string }): Promise<number | null> {
  const r = await fetch(`${site}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": img.contentType, "Content-Disposition": `attachment; filename="${img.filename}"` },
    body: img.bytes,
  });
  if (!r.ok) return null;
  const m = await r.json();
  return m.id || null;
}

async function recordError(sb: any, clientId: number, title: string, keyword: string, error: string) {
  try {
    await sb.from("blog_posts").insert({ client_id: clientId, title: title || "(שגיאה)", keyword, status: "error", error });
  } catch { /* best effort */ }
}
