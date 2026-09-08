/** Shared WordPress page-editing helpers (used by audit-fix and recommendation-apply). */
import { callClaude, DEFAULT_MODEL, textOf } from "./anthropic.ts";

export function normalizeSite(u: string): string {
  let s = (u || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}
export function basicAuth(user: string, pass: string): string { return "Basic " + btoa(`${user}:${pass}`); }
function slugFromUrl(url: string): string {
  try { const u = new URL(url); const parts = u.pathname.split("/").filter(Boolean); return decodeURIComponent(parts[parts.length - 1] || ""); } catch { return ""; }
}

export async function resolveTarget(site: string, auth: string, pageUrl: string): Promise<{ type: "posts" | "pages"; id: number } | null> {
  const slug = slugFromUrl(pageUrl);
  if (!slug) {
    const r = await fetch(`${site}/wp-json/wp/v2/settings`, { headers: { Authorization: auth } });
    if (r.ok) { const s = await r.json(); if (s.page_on_front) return { type: "pages", id: s.page_on_front }; }
    return null;
  }
  for (const type of ["pages", "posts"] as const) {
    const r = await fetch(`${site}/wp-json/wp/v2/${type}?slug=${encodeURIComponent(slug)}&context=edit&_fields=id`, { headers: { Authorization: auth } });
    if (r.ok) { const arr = await r.json(); if (Array.isArray(arr) && arr[0]?.id) return { type, id: arr[0].id }; }
  }
  return null;
}

/**
 * Apply a single instruction to a live page: fetch current content, have Claude apply
 * ONLY that change (preserving everything else) + refresh the meta description, and write
 * it back. WordPress keeps a revision, so it's reversible. Returns { applied, note }.
 */
export async function applyPageFix(cw: any, page: string, instruction: string): Promise<{ applied: boolean; note: string }> {
  const site = normalizeSite(cw.site_url);
  const auth = basicAuth(cw.username, cw.app_password);
  const target = await resolveTarget(site, auth, page);
  if (!target) throw new Error("לא הצלחתי לזהות את העמוד באתר לתיקון אוטומטי");

  const cur = await fetch(`${site}/wp-json/wp/v2/${target.type}/${target.id}?context=edit&_fields=title,excerpt,content`, { headers: { Authorization: auth } });
  if (!cur.ok) throw new Error(`לא ניתן לקרוא את העמוד (${cur.status})`);
  const c = await cur.json();

  const system =
    "אתה מומחה SEO שמבצע שיפור נקודתי בעמוד קיים. יישם אך ורק את השינוי המבוקש ושמר את כל שאר התוכן בדיוק כפי שהוא. " +
    "אל תמחק תוכן, אל תשנה עיצוב, אל תוסיף תוכן שלא נדרש. החזר בפורמט המדויק (בלי טקסט נוסף):\n" +
    "EXCERPT: <תיאור מטא מעודכן, או KEEP אם אין שינוי>\n" +
    "CONTENT:\n<ה-HTML המלא לאחר השינוי — כל התוכן המקורי משומר, רק השיפור הוחל. אם אין צורך לשנות תוכן, כתוב KEEP>";
  const userMsg =
    `שיפור לביצוע: ${instruction}\n\nכותרת נוכחית: ${c.title?.raw || ""}\nתיאור מטא נוכחי: ${c.excerpt?.raw || "(ריק)"}\n\nתוכן HTML נוכחי:\n${(c.content?.raw || "").slice(0, 20000)}`;

  const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: userMsg }] });
  const text = textOf(resp);
  const newExcerpt = (text.match(/EXCERPT:\s*(.+)/)?.[1] || "").trim();
  let newContent = (text.match(/CONTENT:\s*([\s\S]+)$/)?.[1] || "").trim();
  newContent = newContent.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();

  const update: any = {};
  if (newExcerpt && newExcerpt !== "KEEP") update.excerpt = newExcerpt;
  if (newContent && newContent !== "KEEP" && newContent.length > 40) update.content = newContent;
  if (Object.keys(update).length === 0) return { applied: false, note: "לא היה צורך בשינוי" };

  const up = await fetch(`${site}/wp-json/wp/v2/${target.type}/${target.id}`, {
    method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(update),
  });
  if (!up.ok) throw new Error(`WordPress דחה את העדכון (${up.status})`);
  if (update.excerpt) {
    try {
      await fetch(`${site}/wp-json/wp/v2/${target.type}/${target.id}`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ meta: { _yoast_wpseo_metadesc: update.excerpt, rank_math_description: update.excerpt } }) });
    } catch { /* ignore */ }
  }
  const changed = [update.content ? "תוכן" : null, update.excerpt ? "תיאור מטא" : null].filter(Boolean).join(" + ");
  return { applied: true, note: `עודכן: ${changed}. ניתן לשחזר מהיסטוריית הגרסאות ב-WordPress.` };
}
