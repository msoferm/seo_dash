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
import { hasBridge, applyElementorFix } from "../_shared/bridge.ts";
import { applyPageFix } from "../_shared/wpfix.ts";

async function renderedHasNoH1(pageUrl: string): Promise<boolean> {
  try {
    const pub = await fetch(pageUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!pub.ok) return false;
    const html = await pub.text();
    return [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean).length === 0;
  } catch { return false; }
}

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

    const isH1Issue = /\bh1\b/i.test(`${issue} ${fix || ""}`);

    // Bridge path: Elementor pages can't be edited via core REST content — use the bridge.
    if (hasBridge(cw)) {
      try {
        const br = await applyElementorFix(cw, target.id, fix || issue, { modification });
        if (br) { // page is Elementor-managed
          if (!br.applied) return errorResponse(br.note, 422);
          if (isH1Issue && await renderedHasNoH1(page)) {
            return errorResponse(`הטקסט עודכן ב-Elementor, אך בעמוד בפועל עדיין אין תג H1 אמיתי — ה-H1/כותרת מרונדרים כ-H2 ע"י התבנית/הווידג'ט. יש לשנות את רמת הכותרת ב-Elementor ידנית.`, 422);
          }
          await sb.from("audit_issues").update({ status: "applied", applied_note: br.note }).eq("id", issue_id);
          return jsonResponse({ applied: true, target: page, note: br.note });
        }
        // br === null → not an Elementor page; fall through to the classic REST flow.
      } catch (e) {
        console.error("bridge fix failed, falling back to REST:", (e as Error).message);
      }
    }

    // Classic (non-Elementor) path via the shared TARGETED editor — small Claude output,
    // so no 150s timeout and no risk of overwriting the page with a truncated rewrite.
    const instruction = `${fix || issue}` + (modification && modification.trim() ? `\nשינוי/הנחיה של המשתמש: ${modification.trim()}` : "");
    const res = await applyPageFix(cw, page, instruction);
    if (!res.applied) return errorResponse(res.note, 422);

    // For H1 issues, verify a real <h1> renders on the public page; otherwise be honest.
    if (isH1Issue && await renderedHasNoH1(page)) {
      return errorResponse(`השדות עודכנו ב-WordPress, אך בבדיקת העמוד בפועל עדיין אין תג H1 אמיתי — התבנית מרנדרת את הכותרת הראשית כ-H2. יש לתקן זאת בתבנית/בילדר. (השינוי כן בוצע וניתן לשחזור מהיסטוריית הגרסאות.)`, 422);
    }

    await sb.from("audit_issues").update({ status: "applied", applied_note: res.note }).eq("id", issue_id);
    return jsonResponse({ applied: true, target: page, note: res.note });
  } catch (e) {
    return errorResponse(`שגיאה בביצוע התיקון: ${(e as Error).message}`, 500);
  }
});
