/**
 * Core auto-blog logic (shared by the manual trigger and the weekly cron):
 * pick a topic from the client's SEO opportunities → write a full article with Claude
 * → publish to the client's WordPress → record it. Never repeats a recent keyword.
 */
import { callClaude, DEFAULT_MODEL, textOf } from "./anthropic.ts";

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function normalizeSite(u: string): string {
  let s = (u || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}
function basicAuth(user: string, pass: string): string {
  return "Basic " + btoa(`${user}:${pass}`);
}

export interface PublishResult { title: string; url: string; status: string; keyword: string; preview?: string }

export async function publishForClient(sb: any, clientId: number, opts: { dryRun?: boolean } = {}): Promise<PublishResult> {
  const { data: client } = await sb.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (!client) throw new Error("לקוח לא נמצא");
  const { data: cw } = await sb.from("client_wordpress").select("*").eq("client_id", clientId).maybeSingle();
  if (!opts.dryRun) {
    if (!cw) throw new Error("הלקוח לא מחובר ל-WordPress");
    if (!cw.enabled) throw new Error("הבלוג האוטומטי כבוי ללקוח זה");
  }

  // ----- pick a topic (SEO opportunity, avoid recent) -----
  const to = ymd(new Date());
  const from = ymd(new Date(Date.now() - 90 * 86400000));
  const [{ data: opps }, { data: recent }] = await Promise.all([
    sb.rpc("gsc_query_opportunities", { p_client_id: clientId, p_from: from, p_to: to }),
    sb.from("blog_posts").select("keyword").eq("client_id", clientId).order("created_at", { ascending: false }).limit(30),
  ]);
  const used = new Set((recent || []).map((r: any) => (r.keyword || "").trim()).filter(Boolean));
  let keyword = ((opps || []) as any[])
    .filter((o) => o.position >= 6 && o.position <= 40 && o.impressions >= 15 && !used.has(o.term))
    .sort((a, b) => b.impressions - a.impressions)[0]?.term;
  if (!keyword) {
    const { data: kw } = await sb.from("keywords").select("term").eq("client_id", clientId).order("monthly_searches", { ascending: false }).limit(40);
    keyword = (kw || []).map((k: any) => k.term).find((t: string) => t && !used.has(t));
  }
  if (!keyword) throw new Error("אין נושא זמין למאמר — הוסף מילות מפתח או סנכרן GSC");

  // ----- write the article -----
  // Delimiter format (NOT JSON) — long HTML with quotes/newlines breaks JSON parsing.
  const system =
    "אתה כותב תוכן SEO מקצועי בעברית לבלוג עסקי. כתוב מאמר איכותי, מקורי, מועיל וקריא סביב מילת המפתח — " +
    "כותרת מושכת, מבנה עם כותרות H2/H3, פסקאות, ורשימות היכן שמתאים. 500-800 מילים לפחות. שלב את מילת המפתח באופן טבעי (לא ספאם). " +
    "אל תמציא עובדות, מספרים, מחירים או פרטים ספציפיים שאינך יכול לאמת. אם חסר מידע — כתוב באופן כללי ומקצועי. " +
    "החזר בפורמט המדויק הבא ובלי שום טקסט נוסף לפני או אחרי:\n" +
    "TITLE: <הכותרת בשורה אחת>\n" +
    "EXCERPT: <תיאור מטא קצר בשורה אחת, עד 155 תווים>\n" +
    "BODY:\n<גוף המאמר ב-HTML בלבד — h2/h3/p/ul, בלי <html> או <body>>";
  const userMsg =
    `עסק: ${client.name} (דומיין: ${client.domain}). הערות על העסק: ${client.notes || "—"}.\n` +
    `מילת מפתח יעד: "${keyword}".\nכתוב מאמר בלוג שיווקי-מקצועי סביב מילת המפתח.`;

  const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: userMsg }] });
  const text = textOf(resp);
  const title = (text.match(/TITLE:\s*(.+)/)?.[1] || "").trim();
  const excerpt = (text.match(/EXCERPT:\s*(.+)/)?.[1] || "").trim();
  let html = (text.match(/BODY:\s*([\s\S]+)$/)?.[1] || "").trim();
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
  if (!title || html.length < 40) {
    throw new Error(`המאמר שנוצר לא תקין. פלט גולמי: ${text.slice(0, 300)}`);
  }

  if (opts.dryRun) {
    return { title, url: "(dry-run)", status: "dry", keyword, preview: html.slice(0, 400) };
  }

  // ----- publish to WordPress -----
  const site = normalizeSite(cw.site_url);
  let res: Response;
  try {
    res = await fetch(`${site}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: { Authorization: basicAuth(cw.username, cw.app_password), "Content-Type": "application/json" },
      body: JSON.stringify({ title, content: html, excerpt, status: cw.mode }),
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

  await sb.from("blog_posts").insert({
    client_id: clientId, title, keyword, wp_post_id: post.id, url: post.link, status: post.status,
  });
  await sb.from("client_wordpress").update({ last_published_at: new Date().toISOString() }).eq("client_id", clientId);

  return { title, url: post.link, status: post.status, keyword };
}

async function recordError(sb: any, clientId: number, title: string, keyword: string, error: string) {
  try {
    await sb.from("blog_posts").insert({ client_id: clientId, title: title || "(שגיאה)", keyword, status: "error", error });
  } catch { /* best effort */ }
}
