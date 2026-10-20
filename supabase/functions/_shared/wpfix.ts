/** Shared WordPress page-editing helpers (used by audit-fix and recommendation-apply). */
import { callClaude, DEFAULT_MODEL, textOf, extractJson } from "./anthropic.ts";
import { hasBridge, applyElementorFix } from "./bridge.ts";

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

  // Bridge path: Elementor pages can't be edited via core REST content.
  if (hasBridge(cw)) {
    try {
      const br = await applyElementorFix(cw, target.id, instruction);
      if (br) return br; // Elementor page — handled (or honestly reported). null → classic flow.
    } catch (_e) { /* fall back to classic REST flow */ }
  }

  const cur = await fetch(`${site}/wp-json/wp/v2/${target.type}/${target.id}?context=edit&_fields=title,excerpt,content`, { headers: { Authorization: auth } });
  if (!cur.ok) throw new Error(`לא ניתן לקרוא את העמוד (${cur.status})`);
  const c = await cur.json();
  const curTitle = c.title?.raw || "";
  const curExcerpt = c.excerpt?.raw || "";
  const curContent = c.content?.raw || "";

  // Targeted edits only (small output → fast, no 150s timeout, and safer: never rewrites the
  // whole page). Claude returns title/meta + exact find→replace snippets + an optional section.
  const system =
    "אתה מומחה SEO שמבצע שיפור נקודתי בעמוד WordPress, בעריכות ממוקדות בלבד (לא שכתוב של כל העמוד). " +
    "ב-WordPress כותרת ה-H1 הנראית בעמוד היא שדה ה-TITLE, ולרוב אינה בתוך גוף התוכן. " +
    "החזר אך ורק JSON: " +
    '{"title":"<כותרת/H1 חדשה או KEEP>","excerpt":"<תיאור מטא חדש או KEEP>","replacements":[{"find":"<טקסט מדויק שמופיע בתוכן הנוכחי>","replace":"<הטקסט החדש>"}],"append_html":"<HTML של קטע חדש להוספה בסוף העמוד, או מחרוזת ריקה>"}. ' +
    "כל find חייב להיות מחרוזת מדויקת מהתוכן הנוכחי (העתק מילה-במילה). בצע שינוי מינימלי, אל תמחק תוכן. אם אין מה לשנות החזר replacements ריק, title/excerpt=KEEP ו-append_html ריק. התחל ישירות ב-{.";
  const userMsg =
    `שיפור לביצוע: ${instruction}\n\nכותרת (H1) נוכחית: ${curTitle || "(ריק)"}\nתיאור מטא נוכחי: ${curExcerpt || "(ריק)"}\n\nתוכן HTML נוכחי:\n${curContent.slice(0, 12000)}`;

  const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 3000, system, messages: [{ role: "user", content: userMsg }] });
  let p: any; try { p = extractJson(textOf(resp)); } catch { return { applied: false, note: "לא התקבלה תשובה תקינה מהמנוע לעריכת העמוד." }; }

  const newTitle = String(p.title || "").trim();
  const newExcerpt = String(p.excerpt || "").trim();
  let newContent = curContent; let contentChanged = false;
  for (const r of (p.replacements || [])) {
    const find = String(r.find || ""); const rep = String(r.replace || "");
    if (find && find !== rep && newContent.includes(find)) { newContent = newContent.split(find).join(rep); contentChanged = true; }
  }
  const append = String(p.append_html || "").trim();
  if (append.length > 20 && !curContent.includes(append)) { newContent = `${newContent}\n${append}`; contentChanged = true; }

  const update: any = {};
  if (newTitle && newTitle !== "KEEP" && newTitle !== curTitle) update.title = newTitle;
  if (newExcerpt && newExcerpt !== "KEEP" && newExcerpt !== curExcerpt) update.excerpt = newExcerpt;
  if (contentChanged && newContent !== curContent) update.content = newContent;
  if (Object.keys(update).length === 0) return { applied: false, note: "לא בוצע שינוי בפועל — לא נמצאה התאמה מדויקת לעריכה או שאין מה לשנות." };

  const up = await fetch(`${site}/wp-json/wp/v2/${target.type}/${target.id}`, {
    method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(update),
  });
  if (!up.ok) throw new Error(`WordPress דחה את העדכון (${up.status})`);
  if (update.excerpt) {
    try {
      await fetch(`${site}/wp-json/wp/v2/${target.type}/${target.id}`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ meta: { _yoast_wpseo_metadesc: update.excerpt, rank_math_description: update.excerpt } }) });
    } catch { /* ignore */ }
  }

  // Verify the change actually landed on the server.
  const ver = await fetch(`${site}/wp-json/wp/v2/${target.type}/${target.id}?context=edit&_fields=title,excerpt,content`, { headers: { Authorization: auth } });
  const vc = ver.ok ? await ver.json() : null;
  const verified: string[] = [];
  const failed: string[] = [];
  if (update.title != null) ((vc?.title?.raw || "") === update.title ? verified : failed).push("כותרת (H1)");
  if (update.excerpt != null) ((vc?.excerpt?.raw || "") === update.excerpt ? verified : failed).push("תיאור מטא");
  if (update.content != null) ((vc?.content?.raw || "") !== curContent ? verified : failed).push("תוכן");
  if (vc && verified.length === 0) {
    return { applied: false, note: `העדכון נשלח אך לא נראה שינוי בפועל (${failed.join(" + ")}). ככל הנראה מנוהל ע"י בילדר (Elementor/Divi) — יש לתקן ידנית.` };
  }
  return { applied: true, note: `עודכן ואומת: ${verified.join(" + ")}${failed.length ? ` · לא אומת: ${failed.join(" + ")}` : ""}. ניתן לשחזר מהיסטוריית הגרסאות ב-WordPress.` };
}
