/**
 * POST { client_id }
 * Builds a strategic 3-month SEO work plan: 6 pillars (main tasks) each with concrete
 * subtasks. Subtasks are grounded in REAL data (pending recommendations + audit issues are
 * carried in verbatim with their source id so they can be executed), and Claude handles the
 * strategy: assigning each to a month/priority/impact/effort and ADDING advisory subtasks
 * for areas the data doesn't cover (speed, UX, conversions, authority, FAQ).
 *
 * Replaces any previous generated plan (source='plan'); manual/upload tasks are untouched.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL, textOf, extractJson } from "../_shared/anthropic.ts";

const PILLARS: { key: string; title: string }[] = [
  { key: "technical", title: "תשתית טכנית ואינדוקס" },
  { key: "speed", title: "מהירות ו-Core Web Vitals" },
  { key: "content", title: "אופטימיזציית תוכן על-עמודית" },
  { key: "traffic", title: "הרחבת תנועה ותוכן חדש" },
  { key: "authority", title: "סמכות וקישורים" },
  { key: "conversions", title: "המרות ו-UX" },
];
const PILLAR_KEYS = new Set(PILLARS.map((p) => p.key));
const CLAUDE_REC_TYPES = new Set(["title_meta", "improve_page", "add_keywords", "new_content", "internal_link"]);

function pillarForRec(type: string): string {
  if (type === "new_content" || type === "performance_drop") return "traffic";
  if (type === "technical") return "technical";
  return "content";
}
function auditPillar(issue: string): string {
  return /h1|מטא|meta|כותר|title|תוכן|content|faq|alt|תיאור/i.test(issue) ? "content" : "technical";
}
const clampMonth = (m: any): number => { const n = parseInt(m); return n >= 1 && n <= 3 ? n : 2; };
const valLevel = (v: any): string => (["high", "medium", "low"].includes(v) ? v : "medium");

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);

    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);

    const [recRes, auditRes, forumRes, prospectRes, pagesRes, convRes] = await Promise.all([
      sb.from("recommendations").select("id, type, page, title, action, opportunity, potential").eq("client_id", client_id).eq("status", "pending").limit(40),
      sb.from("audit_issues").select("id, page, issue, fix, severity").eq("client_id", client_id).eq("status", "pending").limit(30),
      sb.from("forum_leads").select("id").eq("client_id", client_id).eq("status", "new"),
      sb.from("link_prospects").select("id").eq("client_id", client_id).eq("status", "new"),
      sb.from("pages").select("id, has_faq").eq("client_id", client_id),
      sb.from("ga4_conversions").select("source, channel, conversions, sessions").eq("client_id", client_id).order("sessions", { ascending: false }).limit(8),
    ]);

    const recs = recRes.data || [], audits = auditRes.data || [], pages = pagesRes.data || [], conv = convRes.data || [];

    // ---- Real, linkable candidates ----
    type Cand = { key: string; pillar: string; kind: string; title: string; details: string; source_type: string; source_ref: string };
    const candidates: Cand[] = [];
    for (const r of recs) candidates.push({
      key: `rec:${r.id}`, pillar: pillarForRec(r.type), kind: CLAUDE_REC_TYPES.has(r.type) ? "claude" : "manual",
      title: (r.title || "").slice(0, 160), details: (r.action || r.opportunity || "").slice(0, 160),
      source_type: "recommendation", source_ref: String(r.id),
    });
    for (const a of audits) candidates.push({
      key: `audit:${a.id}`, pillar: auditPillar(a.issue || ""), kind: "claude",
      title: (a.issue || "").slice(0, 160), details: (a.fix || "").slice(0, 160),
      source_type: "audit", source_ref: String(a.id),
    });

    const summary = {
      forum_leads_new: (forumRes.data || []).length,
      prospects_new: (prospectRes.data || []).length,
      pages_total: pages.length,
      pages_without_faq: pages.filter((p: any) => !p.has_faq).length,
      conv_sources: conv.map((c: any) => `${c.source || c.channel || "ישיר"}: ${c.conversions} המרות / ${c.sessions} סשנים`),
    };

    const system =
      "אתה אסטרטג SEO בכיר שבונה תכנית עבודה ל-3 חודשים, מחולקת ל-6 עמודי תווך: " +
      "technical (תשתית טכנית ואינדוקס), speed (מהירות/CWV), content (תוכן על-עמודי), traffic (הרחבת תנועה/תוכן חדש), authority (קישורים/סמכות), conversions (המרות/UX). " +
      "קיבלת רשימת משימות-מועמדות אמיתיות (מתוך נתוני המערכת) וסיכום נתונים. המשימות שלך: " +
      "(1) שבץ לכל מועמד: target_month (1-3), priority, impact, effort. שמור על ה-pillar וה-kind שסופקו אלא אם ברור שגוי. אפשר לנסח כותרת/פירוט קצר וברור יותר. " +
      "(2) הוסף תתי-משימות ייעוץ (kind=manual) לתחומים שהנתונים מצביעים עליהם ואין להם מועמד: מהירות/CWV, UX, המרות (אם יש מקורות עם המרה נמוכה), סמכות (אם יש הזדמנויות קישור/פורומים), ו-FAQ (אם יש עמודים בלי FAQ). לכל אחת תן source_type='tool' ו-source_ref מתוך: speed|ux|conversions|forums|prospects|faq. " +
      "(3) אסטרטגיה: חודש 1 = ניצחונות מהירים + תשתית קריטית; חודש 2 = עומק תוכן + תוכן חדש; חודש 3 = סמכות + המרות. " +
      "לתתי-משימות manual כתוב note עם 2-4 צעדים קונקרטיים לביצוע. " +
      'החזר אך ורק JSON: {"subtasks":[{"key":"<המפתח שסופק או null>","pillar":"<key>","title":"...","details":"...","kind":"claude|manual","target_month":1,"priority":"high|medium|low","impact":"high|medium|low","effort":"high|medium|low","note":"<להנחיה ידנית>","source_type":"recommendation|audit|tool","source_ref":"..."}]}. ' +
      "כלול את כל המועמדים (לפי ה-key שלהם) בתוספת משימות הייעוץ. כתוב בעברית. התחל ישירות ב-{.";

    const userMsg =
      `עסק: ${client.name} (${client.domain})\nהערות: ${client.notes || "אין"}\n\n` +
      `סיכום נתונים:\n- הזדמנויות קישור בפורומים (חדשות): ${summary.forum_leads_new}\n- הזדמנויות קישור כלליות (חדשות): ${summary.prospects_new}\n` +
      `- עמודים: ${summary.pages_total} (ללא FAQ: ${summary.pages_without_faq})\n- מקורות המרה: ${summary.conv_sources.join(" | ") || "אין נתונים"}\n\n` +
      `משימות-מועמדות (${candidates.length}):\n` +
      candidates.map((c) => `[${c.key}] pillar=${c.pillar} kind=${c.kind} | ${c.title}${c.details ? ` — ${c.details}` : ""}`).join("\n");

    const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: userMsg }] });
    let parsed: any; try { parsed = extractJson(textOf(resp)); } catch { return errorResponse(`המנוע החזיר תשובה שלא ניתן לפענח: ${textOf(resp).slice(0, 200)}`, 502); }
    const claudeSubs: any[] = Array.isArray(parsed) ? parsed : (parsed.subtasks || []);

    const byKey = new Map(candidates.map((c) => [c.key, c]));
    const assigned = new Map<string, any>();
    const advisory: any[] = [];
    for (const s of claudeSubs) {
      if (s.key && byKey.has(s.key)) assigned.set(s.key, s);
      else if (!s.key || s.key === "null") advisory.push(s);
    }

    // Merge: every real candidate kept (Claude's scheduling overlaid), plus advisory additions.
    type Final = Cand & { target_month: number; priority: string; impact: string; effort: string; note: string | null };
    const final: Final[] = [];
    for (const c of candidates) {
      const a = assigned.get(c.key) || {};
      final.push({
        ...c,
        pillar: PILLAR_KEYS.has(a.pillar) ? a.pillar : c.pillar,
        title: (a.title || c.title || "משימה").slice(0, 200), details: (a.details || c.details || "").slice(0, 600),
        target_month: clampMonth(a.target_month), priority: valLevel(a.priority), impact: valLevel(a.impact), effort: valLevel(a.effort),
        note: a.note ? String(a.note).slice(0, 1200) : null,
      });
    }
    for (const s of advisory) {
      const pillar = PILLAR_KEYS.has(s.pillar) ? s.pillar : "content";
      final.push({
        key: "", pillar, kind: s.kind === "claude" ? "claude" : "manual",
        title: String(s.title || "משימה").slice(0, 200), details: String(s.details || "").slice(0, 600),
        source_type: s.source_type === "recommendation" || s.source_type === "audit" ? "tool" : (s.source_type || "tool"),
        source_ref: s.source_ref ? String(s.source_ref).slice(0, 60) : "",
        target_month: clampMonth(s.target_month), priority: valLevel(s.priority), impact: valLevel(s.impact), effort: valLevel(s.effort),
        note: s.note ? String(s.note).slice(0, 1200) : null,
      });
    }
    if (final.length === 0) return jsonResponse({ created: 0, pillars: 0, note: "אין מספיק נתונים לבניית תכנית. הרץ קודם מנוע המלצות/אודיט." });

    // Replace the previous generated plan (keep manual/upload/claude single tasks).
    await sb.from("tasks").delete().eq("client_id", client_id).eq("source", "plan");

    // Create only pillars that have subtasks.
    const usedPillars = PILLARS.filter((p) => final.some((f) => f.pillar === p.key));
    const pillarId = new Map<string, number>();
    let order = 0;
    for (const p of usedPillars) {
      const { data, error } = await sb.from("tasks").insert({
        client_id, title: p.title, is_pillar: true, category: p.key, source: "plan", status: "open", sort_order: order++,
      }).select("id").single();
      if (error) throw new Error(`pillar insert: ${error.message}`);
      pillarId.set(p.key, data.id);
    }

    const rows = final
      .sort((a, b) => a.target_month - b.target_month)
      .map((f, i) => ({
        client_id, parent_id: pillarId.get(f.pillar)!, category: f.pillar, is_pillar: false,
        title: f.title, details: f.details || null, kind: f.kind, target_month: f.target_month,
        priority: f.priority, impact: f.impact, effort: f.effort, note: f.note,
        source_type: f.source_type, source_ref: f.source_ref || null, source: "plan", status: "open", sort_order: i,
      }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from("tasks").insert(rows.slice(i, i + 200));
      if (error) throw new Error(`subtask insert: ${error.message}`);
    }

    return jsonResponse({ created: rows.length, pillars: usedPillars.length });
  } catch (e) {
    return errorResponse(`שגיאה בבניית התכנית: ${(e as Error).message}`, 500);
  }
});
