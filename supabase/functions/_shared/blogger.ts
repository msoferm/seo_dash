/**
 * Auto-blog engine. Two paths:
 *  - Semi-automatic (default): proposeForClient() suggests a topic + rationale; the team
 *    approves; approveProposal() writes & publishes the approved topic.
 *  - Full-auto: publishForClient() picks a topic and publishes in one step.
 * Topic is chosen from GSC opportunities + ZEFO rank data; articles follow the per-client
 * blog_instructions; published to WordPress with a featured image + SEO title/meta.
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
export interface ProposalResult { keyword: string; title: string; reason: string }

// ---------- topic selection ----------
async function pickTopic(sb: any, clientId: number): Promise<{ keyword: string; related: string[]; stats: string } | null> {
  const to = ymd(new Date());
  const from = ymd(new Date(Date.now() - 90 * 86400000));
  const [{ data: opps }, { data: recent }, { data: zefo }, { data: kw }] = await Promise.all([
    sb.rpc("gsc_query_opportunities", { p_client_id: clientId, p_from: from, p_to: to }),
    sb.from("blog_posts").select("keyword").eq("client_id", clientId).order("created_at", { ascending: false }).limit(60),
    sb.from("zefo_keywords").select("keyword, ranking, local_searches, difficulty").eq("client_id", clientId).order("local_searches", { ascending: false, nullsFirst: false }).limit(60),
    sb.from("keywords").select("term, monthly_searches").eq("client_id", clientId).order("monthly_searches", { ascending: false }).limit(40),
  ]);
  const used = new Set((recent || []).map((r: any) => (r.keyword || "").trim()).filter(Boolean));

  const scored = new Map<string, number>();
  const meta = new Map<string, string>();
  for (const o of (opps || []) as any[]) {
    if (o.position >= 6 && o.position <= 40 && o.impressions >= 15) {
      const t = (o.term || "").trim();
      if (t && !used.has(t)) { scored.set(t, Math.max(scored.get(t) || 0, o.impressions * 2)); meta.set(t, `GSC: ${o.impressions} חשיפות במיקום ${o.position}`); }
    }
  }
  for (const z of (zefo || []) as any[]) {
    const vol = z.local_searches || 0;
    if (vol < 10) continue;
    const t = (z.keyword || "").trim();
    if (!t || used.has(t)) continue;
    const posBonus = z.ranking && z.ranking >= 4 && z.ranking <= 30 ? 1.6 : 1;
    const diffPenalty = z.difficulty && z.difficulty > 60 ? 0.6 : 1;
    const score = vol * posBonus * diffPenalty;
    if (score > (scored.get(t) || 0)) { scored.set(t, score); meta.set(t, `ZEFO: ${vol} חיפושים חודשיים${z.ranking ? `, מיקום נוכחי ${z.ranking}` : ", לא מדורג"}${z.difficulty ? `, קושי ${z.difficulty}` : ""}`); }
  }
  for (const k of (kw || []) as any[]) {
    const t = (k.term || "").trim();
    if (!t || used.has(t)) continue;
    const score = (k.monthly_searches || 0) * 0.5;
    if (score > (scored.get(t) || 0)) { scored.set(t, score); meta.set(t, `נפח חיפוש ${k.monthly_searches}`); }
  }

  const keyword = [...scored.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!keyword) return null;
  const related = ((zefo || []) as any[])
    .filter((z) => z.keyword && z.keyword !== keyword && (z.local_searches || 0) > 0)
    .slice(0, 15)
    .map((z) => `${z.keyword}${z.local_searches ? ` (${z.local_searches} חיפושים${z.ranking ? `, מיקום ${z.ranking}` : ""})` : ""}`);
  return { keyword, related, stats: meta.get(keyword) || "" };
}

// ---------- propose (semi-auto step 1) ----------
export async function proposeForClient(sb: any, clientId: number): Promise<ProposalResult> {
  const { data: client } = await sb.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (!client) throw new Error("לקוח לא נמצא");
  const topic = await pickTopic(sb, clientId);
  if (!topic) throw new Error("אין נושא זמין להצעה — הוסף מילות מפתח / סנכרן GSC ו-ZEFO");
  const { data: cw } = await sb.from("client_wordpress").select("blog_instructions").eq("client_id", clientId).maybeSingle();
  const instructions = (cw?.blog_instructions || "").trim();

  const system =
    "אתה יועץ SEO שמציע נושא למאמר בלוג ומסביר בקצרה למה. בהינתן מילת המפתח והנתונים, החזר בפורמט המדויק (בלי טקסט נוסף):\n" +
    "TITLE: <כותרת מוצעת למאמר>\n" +
    "REASON: <2-4 משפטים: למה כדאי לכתוב על זה עכשיו (לפי הנתונים) ומה המאמר יכסה>";
  const userMsg =
    `עסק: ${client.name} (${client.domain}). ${client.notes ? "הערות: " + client.notes + ". " : ""}` +
    (instructions ? `הנחיות הצוות: ${instructions}. ` : "") +
    `מילת מפתח יעד: "${topic.keyword}". נתוני הזדמנות: ${topic.stats}.`;

  const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 800, system, messages: [{ role: "user", content: userMsg }] });
  const text = textOf(resp);
  const title = (text.match(/TITLE:\s*(.+)/)?.[1] || topic.keyword).trim();
  const reasonBody = (text.match(/REASON:\s*([\s\S]+)$/)?.[1] || "").trim();
  const reason = `נבחר לפי: ${topic.stats}.\n${reasonBody}`;

  const { error } = await sb.from("blog_posts").insert({ client_id: clientId, keyword: topic.keyword, title, reason, status: "proposed" });
  if (error) throw new Error(error.message);
  return { keyword: topic.keyword, title, reason };
}

// ---------- write + publish a specific keyword ----------
async function writeAndPublish(sb: any, clientId: number, keyword: string, opts: { proposalId?: number; dryRun?: boolean } = {}): Promise<PublishResult> {
  const { data: client } = await sb.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (!client) throw new Error("לקוח לא נמצא");
  const { data: cw } = await sb.from("client_wordpress").select("*").eq("client_id", clientId).maybeSingle();
  if (!opts.dryRun) {
    if (!cw) throw new Error("הלקוח לא מחובר ל-WordPress");
    if (!cw.enabled) throw new Error("הבלוג האוטומטי כבוי ללקוח זה");
  }
  const { data: zefo } = await sb.from("zefo_keywords").select("keyword, ranking, local_searches").eq("client_id", clientId).order("local_searches", { ascending: false, nullsFirst: false }).limit(30);
  const related = ((zefo || []) as any[]).filter((z) => z.keyword && z.keyword !== keyword && (z.local_searches || 0) > 0).slice(0, 15)
    .map((z) => `${z.keyword}${z.local_searches ? ` (${z.local_searches} חיפושים${z.ranking ? `, מיקום ${z.ranking}` : ""})` : ""}`);
  const instructions = (cw?.blog_instructions || "").trim();

  const system =
    "אתה כותב תוכן SEO מקצועי בעברית לבלוג עסקי. כתוב מאמר איכותי, מקורי ומועיל סביב מילת המפתח — כותרת ממוקדת-SEO, מבנה H2/H3, פסקאות ורשימות. 600-900 מילים. " +
    "שלב את מילת המפתח באופן טבעי ושזור מונחים קשורים מהרשימה שסופקה. אל תמציא עובדות/מספרים/מחירים שאינך יכול לאמת. " +
    (instructions ? `הנחיות חובה של הצוות (כבד תמיד): ${instructions}\n` : "") +
    "החזר בפורמט המדויק (בלי טקסט נוסף):\n" +
    "TITLE: <כותרת SEO, עד 60 תווים, כוללת את מילת המפתח>\n" +
    "EXCERPT: <תיאור מטא לקידום אורגני, 120-155 תווים, כולל את מילת המפתח>\n" +
    "IMAGE: <2-4 מילות חיפוש באנגלית לתמונה>\n" +
    "BODY:\n<גוף המאמר ב-HTML בלבד — h2/h3/p/ul>";
  const userMsg =
    `עסק: ${client.name} (${client.domain}). הערות: ${client.notes || "—"}.\n` +
    `מילת מפתח יעד: "${keyword}".\n` +
    (related.length ? `מילות מפתח קשורות (ZEFO): ${related.join(" | ")}.\n` : "") +
    `כתוב מאמר בלוג שיווקי-מקצועי.`;

  const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: userMsg }] });
  const text = textOf(resp);
  const title = (text.match(/TITLE:\s*(.+)/)?.[1] || "").trim();
  const excerpt = (text.match(/EXCERPT:\s*(.+)/)?.[1] || "").trim();
  const imageQuery = (text.match(/IMAGE:\s*(.+)/)?.[1] || "").trim();
  let html = (text.match(/BODY:\s*([\s\S]+)$/)?.[1] || "").trim();
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
  if (!title || html.length < 40) throw new Error(`המאמר שנוצר לא תקין. פלט גולמי: ${text.slice(0, 300)}`);
  if (opts.dryRun) return { title, url: "(dry-run)", status: "dry", keyword, image: !!imageQuery, preview: `[image: ${imageQuery}] ` + html.slice(0, 350) };

  const site = normalizeSite(cw.site_url);
  const auth = basicAuth(cw.username, cw.app_password);
  let featuredMedia: number | null = null;
  try {
    const img = await fetchPexels(imageQuery || keyword);
    if (img) featuredMedia = await uploadMedia(site, auth, img);
  } catch { /* image best-effort */ }

  const postBody: any = { title, content: html, excerpt, status: cw.mode };
  if (featuredMedia) postBody.featured_media = featuredMedia;
  let res: Response;
  try {
    res = await fetch(`${site}/wp-json/wp/v2/posts`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(postBody) });
  } catch (e) {
    await recordError(sb, clientId, title, keyword, `שגיאת רשת ל-WordPress: ${(e as Error).message}`, opts.proposalId);
    throw new Error(`לא ניתן להגיע ל-WordPress בכתובת ${site}`);
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    await recordError(sb, clientId, title, keyword, `WordPress ${res.status}: ${body}`, opts.proposalId);
    throw new Error(`WordPress דחה את הבקשה (${res.status}).`);
  }
  const post = await res.json();
  try {
    await fetch(`${site}/wp-json/wp/v2/posts/${post.id}`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ meta: { _yoast_wpseo_title: title, _yoast_wpseo_metadesc: excerpt, rank_math_title: title, rank_math_description: excerpt } }) });
  } catch { /* meta best-effort */ }

  const row = { title, keyword, wp_post_id: post.id, url: post.link, status: post.status, error: null };
  if (opts.proposalId) await sb.from("blog_posts").update(row).eq("id", opts.proposalId);
  else await sb.from("blog_posts").insert({ client_id: clientId, ...row });
  await sb.from("client_wordpress").update({ last_published_at: new Date().toISOString() }).eq("client_id", clientId);
  return { title, url: post.link, status: post.status, keyword, image: !!featuredMedia };
}

// ---------- full-auto (pick + write + publish) ----------
export async function publishForClient(sb: any, clientId: number, opts: { dryRun?: boolean } = {}): Promise<PublishResult> {
  const topic = await pickTopic(sb, clientId);
  if (!topic) throw new Error("אין נושא זמין למאמר — הוסף מילות מפתח / סנכרן GSC ו-ZEFO");
  return await writeAndPublish(sb, clientId, topic.keyword, { dryRun: opts.dryRun });
}

// ---------- approve a proposal → write + publish ----------
export async function approveProposal(sb: any, proposalId: number): Promise<PublishResult> {
  const { data: p } = await sb.from("blog_posts").select("*").eq("id", proposalId).maybeSingle();
  if (!p) throw new Error("ההצעה לא נמצאה");
  if (p.status !== "proposed") throw new Error("ההצעה כבר טופלה");
  return await writeAndPublish(sb, p.client_id, p.keyword, { proposalId });
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
  return { bytes: new Uint8Array(await ir.arrayBuffer()), filename: (query.replace(/[^a-z0-9]+/gi, "-").slice(0, 40) || "featured") + ".jpg", contentType: "image/jpeg" };
}

async function uploadMedia(site: string, auth: string, img: { bytes: Uint8Array; filename: string; contentType: string }): Promise<number | null> {
  const r = await fetch(`${site}/wp-json/wp/v2/media`, { method: "POST", headers: { Authorization: auth, "Content-Type": img.contentType, "Content-Disposition": `attachment; filename="${img.filename}"` }, body: img.bytes });
  if (!r.ok) return null;
  const m = await r.json();
  return m.id || null;
}

async function recordError(sb: any, clientId: number, title: string, keyword: string, error: string, proposalId?: number) {
  try {
    if (proposalId) await sb.from("blog_posts").update({ status: "error", error }).eq("id", proposalId);
    else await sb.from("blog_posts").insert({ client_id: clientId, title: title || "(שגיאה)", keyword, status: "error", error });
  } catch { /* best effort */ }
}
