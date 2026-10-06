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
      "אתה מומחה SEO שמבצע תיקון נקודתי אחד בעמוד WordPress קיים. יישם אך ורק את התיקון המבוקש ושמר על כל שאר התוכן בדיוק כפי שהוא. " +
      "אל תמחק תוכן קיים, אל תשנה עיצוב, ואל תוסיף תוכן שלא נדרש. " +
      "חשוב: ב-WordPress כותרת ה-H1 הנראית בעמוד היא שדה ה-TITLE של העמוד (הכותרת), ולרוב אינה מופיעה בתוך ה-HTML של גוף התוכן. " +
      "לכן תיקון של H1 / כותרת ראשית / title מתבצע דרך שדה TITLE, ולא דרך CONTENT. " +
      "החזר בפורמט המדויק (בלי טקסט נוסף):\n" +
      "TITLE: <הכותרת/H1 המעודכנת, או המילה KEEP אם אין שינוי>\n" +
      "EXCERPT: <תיאור מטא מעודכן, או המילה KEEP אם אין שינוי>\n" +
      "CONTENT:\n<ה-HTML המלא של גוף העמוד לאחר התיקון — כל התוכן המקורי משומר, רק התיקון הוחל. אם אין צורך לשנות תוכן, כתוב KEEP>";
    const userMsg =
      `בעיה שזוהתה: ${issue}\nתיקון מומלץ: ${fix || issue}\n` +
      (modification && modification.trim() ? `שינוי/הנחיה של המשתמש (יש לכבד): ${modification.trim()}\n` : "") +
      `\nכותרת (H1) נוכחית: ${curTitle || "(ריק)"}\nתיאור מטא נוכחי: ${curExcerpt || "(ריק)"}\n\nתוכן HTML נוכחי:\n${curContent.slice(0, 20000)}`;

    const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: userMsg }] });
    const text = textOf(resp);
    const newTitle = (text.match(/TITLE:\s*(.+)/)?.[1] || "").trim();
    const newExcerpt = (text.match(/EXCERPT:\s*(.+)/)?.[1] || "").trim();
    let newContent = (text.match(/CONTENT:\s*([\s\S]+)$/)?.[1] || "").trim();
    newContent = newContent.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();

    const update: any = {};
    if (newTitle && newTitle !== "KEEP" && newTitle !== curTitle) update.title = newTitle;
    if (newExcerpt && newExcerpt !== "KEEP" && newExcerpt !== curExcerpt) update.excerpt = newExcerpt;
    if (newContent && newContent !== "KEEP" && newContent.length > 40 && newContent !== curContent) update.content = newContent;
    if (Object.keys(update).length === 0) {
      // Nothing changed — be honest, do NOT mark as fixed, leave it actionable.
      return errorResponse("לא בוצע שינוי בפועל: קלוד קבע שאין מה לתקן או לא הצליח לייצר שינוי לעמוד הזה. ייתכן שה-H1 מגיע מתבנית/בילדר (Elementor) ולא מהכותרת. אפשר לנסות שוב עם 'עם שינוי' ולפרט מה בדיוק לשנות, או לתקן ידנית.", 422);
    }

    const up = await fetch(`${site}/wp-json/wp/v2/${target.type}/${target.id}`, {
      method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(update),
    });
    if (!up.ok) {
      const body = await up.text().catch(() => "");
      return errorResponse(`WordPress דחה את העדכון (${up.status}) ${body.slice(0, 160)}`, 502);
    }
    // best-effort Yoast/RankMath meta
    if (update.excerpt) {
      try {
        await fetch(`${site}/wp-json/wp/v2/${target.type}/${target.id}`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ meta: { _yoast_wpseo_metadesc: update.excerpt, rank_math_description: update.excerpt } }) });
      } catch { /* ignore */ }
    }

    // Verify the change actually landed on the server (re-fetch and compare).
    const ver = await fetch(`${site}/wp-json/wp/v2/${target.type}/${target.id}?context=edit&_fields=title,excerpt,content`, { headers: { Authorization: auth } });
    const vc = ver.ok ? await ver.json() : null;
    const verified: string[] = [];
    const failed: string[] = [];
    if (update.title != null) ((vc?.title?.raw || "") === update.title ? verified : failed).push("כותרת (H1)");
    if (update.excerpt != null) ((vc?.excerpt?.raw || "") === update.excerpt ? verified : failed).push("תיאור מטא");
    if (update.content != null) ((vc?.content?.raw || "") !== curContent ? verified : failed).push("תוכן");

    if (vc && verified.length === 0) {
      // Server accepted the request but nothing actually changed — likely a page builder owns the content.
      return errorResponse(`העדכון נשלח ל-WordPress אך לא נראה שינוי בפועל (${failed.join(" + ")}). ככל הנראה התוכן/הכותרת מנוהלים ע"י בילדר (Elementor/Divi) ולא דרך העורך הרגיל. יש לתקן זאת ידנית בבילדר.`, 422);
    }

    // For H1 / heading issues, field-level success is not enough: the theme may render the
    // title as H2 (or strip body H1s). Verify against the RENDERED public page.
    const isH1Issue = /\bh1\b/i.test(`${issue} ${fix || ""}`);
    if (isH1Issue) {
      try {
        const pub = await fetch(page, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (pub.ok) {
          const html = await pub.text();
          const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
          if (h1s.length === 0) {
            return errorResponse(
              `השדות עודכנו ב-WordPress, אך בבדיקת העמוד בפועל עדיין אין תג H1 אמיתי — התבנית (theme) מרנדרת את הכותרת הראשית כ-H2. לא ניתן ליצור H1 תקין דרך עריכת תוכן/כותרת ב-REST; יש לתקן זאת בהגדרות התבנית או בבילדר. (שינוי הכותרת כן בוצע וניתן לשחזור מהיסטוריית הגרסאות.)`,
              422,
            );
          }
        }
      } catch { /* if the public fetch fails, fall through to field-level result */ }
    }

    const note = `עודכן ואומת: ${verified.join(" + ")}${failed.length ? ` · לא אומת: ${failed.join(" + ")}` : ""}. ניתן לשחזר מהיסטוריית הגרסאות ב-WordPress.`;
    await sb.from("audit_issues").update({ status: "applied", applied_note: note }).eq("id", issue_id);
    return jsonResponse({ applied: true, target: page, verified, failed, note });
  } catch (e) {
    return errorResponse(`שגיאה בביצוע התיקון: ${(e as Error).message}`, 500);
  }
});
