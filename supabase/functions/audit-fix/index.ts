/**
 * POST { client_id, page, issue, fix }
 * Applies a single audited SEO fix to the target WordPress page/post:
 * resolves the page by URL, asks Claude to apply ONLY that fix to the existing content
 * (preserving everything else), and updates via REST. WordPress keeps a revision, so the
 * change is reversible from the post's revision history.
 * Returns { applied, target, note }.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL, textOf } from "../_shared/anthropic.ts";

function normalizeSite(u: string): string {
  let s = (u || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}
function basicAuth(user: string, pass: string): string { return "Basic " + btoa(`${user}:${pass}`); }
function slugFromUrl(url: string): string {
  try { const u = new URL(url); const parts = u.pathname.split("/").filter(Boolean); return decodeURIComponent(parts[parts.length - 1] || ""); } catch { return ""; }
}

async function resolveTarget(site: string, auth: string, pageUrl: string): Promise<{ type: "posts" | "pages"; id: number } | null> {
  const slug = slugFromUrl(pageUrl);
  if (!slug) {
    // homepage → front page id (requires admin, which the connected user has)
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

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { issue_id, modification } = await req.json();
    if (!issue_id) return errorResponse("חסר issue_id", 400);

    const { data: row } = await sb.from("audit_issues").select("*").eq("id", issue_id).maybeSingle();
    if (!row) return errorResponse("הבעיה לא נמצאה", 404);
    const client_id = row.client_id, page = row.page, issue = row.issue, fix = row.fix;

    const { data: cw } = await sb.from("client_wordpress").select("*").eq("client_id", client_id).maybeSingle();
    if (!cw) return errorResponse("הלקוח לא מחובר ל-WordPress", 400);
    const site = normalizeSite(cw.site_url);
    const auth = basicAuth(cw.username, cw.app_password);

    const target = await resolveTarget(site, auth, page);
    if (!target) return errorResponse("לא הצלחתי לזהות את העמוד באתר לתיקון אוטומטי", 404);

    // current content
    const cur = await fetch(`${site}/wp-json/wp/v2/${target.type}/${target.id}?context=edit&_fields=title,excerpt,content`, { headers: { Authorization: auth } });
    if (!cur.ok) return errorResponse(`לא ניתן לקרוא את העמוד (${cur.status})`, 502);
    const c = await cur.json();
    const curTitle = c.title?.raw || "";
    const curExcerpt = c.excerpt?.raw || "";
    const curContent = c.content?.raw || "";

    const system =
      "אתה מומחה SEO שמבצע תיקון נקודתי אחד בעמוד קיים. יישם אך ורק את התיקון המבוקש ושמר את כל שאר התוכן בדיוק כפי שהוא. " +
      "אל תמחק תוכן קיים, אל תשנה עיצוב, ואל תוסיף תוכן שלא נדרש. " +
      "החזר בפורמט המדויק (בלי טקסט נוסף):\n" +
      "EXCERPT: <תיאור מטא מעודכן, או המילה KEEP אם אין שינוי>\n" +
      "CONTENT:\n<ה-HTML המלא של גוף העמוד לאחר התיקון — כל התוכן המקורי משומר, רק התיקון הוחל. אם אין צורך לשנות תוכן, כתוב KEEP>";
    const userMsg =
      `בעיה שזוהתה: ${issue}\nתיקון מומלץ: ${fix || issue}\n` +
      (modification && modification.trim() ? `שינוי/הנחיה של המשתמש (יש לכבד): ${modification.trim()}\n` : "") +
      `\nכותרת נוכחית: ${curTitle}\nתיאור מטא נוכחי: ${curExcerpt || "(ריק)"}\n\nתוכן HTML נוכחי:\n${curContent.slice(0, 20000)}`;

    const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: userMsg }] });
    const text = textOf(resp);
    const newExcerpt = (text.match(/EXCERPT:\s*(.+)/)?.[1] || "").trim();
    let newContent = (text.match(/CONTENT:\s*([\s\S]+)$/)?.[1] || "").trim();
    newContent = newContent.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();

    const update: any = {};
    if (newExcerpt && newExcerpt !== "KEEP") update.excerpt = newExcerpt;
    if (newContent && newContent !== "KEEP" && newContent.length > 40) update.content = newContent;
    if (Object.keys(update).length === 0) {
      await sb.from("audit_issues").update({ status: "applied", applied_note: "לא היה צורך בשינוי" }).eq("id", issue_id);
      return jsonResponse({ applied: false, target: page, note: "לא היה צורך בשינוי" });
    }

    const up = await fetch(`${site}/wp-json/wp/v2/${target.type}/${target.id}`, {
      method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(update),
    });
    if (!up.ok) return errorResponse(`WordPress דחה את העדכון (${up.status})`, 502);
    // best-effort Yoast/RankMath meta
    if (update.excerpt) {
      try {
        await fetch(`${site}/wp-json/wp/v2/${target.type}/${target.id}`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ meta: { _yoast_wpseo_metadesc: update.excerpt, rank_math_description: update.excerpt } }) });
      } catch { /* ignore */ }
    }

    const changed = [update.content ? "תוכן" : null, update.excerpt ? "תיאור מטא" : null].filter(Boolean).join(" + ");
    const note = `עודכן: ${changed}. ניתן לשחזר מהיסטוריית הגרסאות ב-WordPress.`;
    await sb.from("audit_issues").update({ status: "applied", applied_note: note }).eq("id", issue_id);
    return jsonResponse({ applied: true, target: page, note });
  } catch (e) {
    return errorResponse(`שגיאה בביצוע התיקון: ${(e as Error).message}`, 500);
  }
});
