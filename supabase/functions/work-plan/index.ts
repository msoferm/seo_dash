/**
 * POST { client_id }
 * Builds a strategic 3-month SEO work plan: 6 pillars (main tasks) each with concrete
 * subtasks. Subtasks are built deterministically from REAL data (pending recommendations +
 * audit issues are carried verbatim with their source id so they're executable; plus a few
 * advisory tasks for speed/UX/conversions/authority/FAQ). Claude only does a COMPACT
 * scheduling pass (month/priority/impact/effort per item) — and if that fails for any
 * reason, sensible defaults are used, so a plan is always produced.
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
const DEFAULT_MONTH: Record<string, number> = { technical: 1, content: 1, speed: 1, traffic: 2, authority: 2, conversions: 3 };
const clampMonth = (m: any, def: number): number => { const n = parseInt(m); return n >= 1 && n <= 3 ? n : def; };
const valLevel = (v: any, def = "medium"): string => (["high", "medium", "low"].includes(v) ? v : def);

interface Sub {
  key: string; pillar: string; kind: string; title: string; details: string;
  source_type: string; source_ref: string;
  month: number; priority: string; impact: string; effort: string; note: string | null;
  writes_text?: boolean; page_url?: string | null; due_date?: string;
}
const WRITES_TEXT_REC = new Set(["new_content", "improve_page", "title_meta", "add_keywords"]);

const PRI_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
function iso(d: Date): string { return d.toISOString().slice(0, 10); }
/** Spread subtasks across Israeli working days (Sun–Thu) within each month block. */
function assignDueDates(subs: Sub[]) {
  const today = new Date();
  const workdays: Date[][] = [[], [], []]; // month blocks 1..3
  for (let i = 0; i < 95; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const wd = d.getDay(); if (wd === 5 || wd === 6) continue; // skip Fri/Sat
    const block = i < 30 ? 0 : i < 60 ? 1 : 2;
    workdays[block].push(d);
  }
  for (const m of [1, 2, 3]) {
    const block = workdays[m - 1].length ? workdays[m - 1] : workdays.flat();
    const items = subs.filter((s) => s.month === m)
      .sort((a, b) => (PRI_ORDER[a.priority] ?? 1) - (PRI_ORDER[b.priority] ?? 1));
    items.forEach((s, i) => {
      const idx = Math.min(block.length - 1, Math.floor((i * block.length) / Math.max(1, items.length)));
      s.due_date = iso(block[idx] || today);
    });
  }
}

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
      sb.from("recommendations").select("id, type, title, action, opportunity, potential, page").eq("client_id", client_id).eq("status", "pending").limit(25),
      sb.from("audit_issues").select("id, issue, fix, severity, page").eq("client_id", client_id).eq("status", "pending").limit(15),
      sb.from("forum_leads").select("id").eq("client_id", client_id).eq("status", "new"),
      sb.from("link_prospects").select("id").eq("client_id", client_id).eq("status", "new"),
      sb.from("pages").select("id, has_faq").eq("client_id", client_id),
      sb.from("ga4_conversions").select("source, channel, conversions, sessions").eq("client_id", client_id).order("sessions", { ascending: false }).limit(6),
    ]);

    const recs = recRes.data || [], audits = auditRes.data || [], pages = pagesRes.data || [], conv = convRes.data || [];
    const forumNew = (forumRes.data || []).length, prospectNew = (prospectRes.data || []).length;
    const pagesNoFaq = pages.filter((p: any) => !p.has_faq).length;

    const subs: Sub[] = [];
    const push = (s: Partial<Sub> & { pillar: string; kind: string; title: string; source_type: string; source_ref: string; key: string }) =>
      subs.push({
        details: "", note: null, writes_text: false, page_url: null, month: DEFAULT_MONTH[s.pillar] ?? 2, priority: "medium", impact: "medium", effort: "medium",
        ...s,
      } as Sub);

    // --- Real, executable candidates ---
    for (const r of recs) push({
      key: `rec:${r.id}`, pillar: pillarForRec(r.type), kind: CLAUDE_REC_TYPES.has(r.type) ? "claude" : "manual",
      title: (r.title || "").slice(0, 160), details: (r.action || r.opportunity || "").slice(0, 300),
      source_type: "recommendation", source_ref: String(r.id), page_url: r.page || null,
      priority: r.potential && ["high", "medium", "low"].includes(r.potential) ? r.potential : "medium",
      impact: r.potential && ["high", "medium", "low"].includes(r.potential) ? r.potential : "medium",
      writes_text: WRITES_TEXT_REC.has(r.type),
    });
    for (const a of audits) push({
      key: `audit:${a.id}`, pillar: auditPillar(a.issue || ""), kind: "claude",
      title: (a.issue || "").slice(0, 160), details: (a.fix || "").slice(0, 300),
      source_type: "audit", source_ref: String(a.id), page_url: a.page || null,
      priority: a.severity === "high" ? "high" : a.severity === "low" ? "low" : "medium",
      writes_text: auditPillar(a.issue || "") === "content",
    });

    // --- Deterministic advisory (always reliable) ---
    let adv = 0;
    push({ key: `adv:${adv++}`, pillar: "speed", kind: "manual", title: "בדיקת מהירות ו-Core Web Vitals", details: "הרץ PageSpeed Insights לעמודים המובילים וטפל ב-LCP / CLS / INP (תמונות, קאשינג, סקריפטים).", source_type: "tool", source_ref: "speed", month: 1, priority: "high", impact: "high" });
    if (pagesNoFaq > 0) push({ key: `adv:${adv++}`, pillar: "content", kind: "claude", title: `הוספת FAQ ל-${pagesNoFaq} עמודים ללא FAQ`, details: "צור FAQ מובנה (Schema) לעמודים מרכזיים — משפר נראות ו-Rich Results.", source_type: "tool", source_ref: "faq", month: 2, priority: "medium", impact: "medium", writes_text: true });
    if (forumNew + prospectNew > 0) push({ key: `adv:${adv++}`, pillar: "authority", kind: "manual", title: `טיפול ב-${forumNew + prospectNew} הזדמנויות קישור`, details: `${forumNew} בפורומים, ${prospectNew} באיתור קישורים — עבור, אשר ובצע את המתאימות.`, source_type: "tool", source_ref: forumNew ? "forums" : "prospects", month: 2, priority: "medium", impact: "high" });
    if (conv.length) push({ key: `adv:${adv++}`, pillar: "conversions", kind: "manual", title: "שיפור מקורות עם המרה נמוכה", details: conv.map((c: any) => `${c.source || c.channel || "ישיר"}: ${c.conversions}/${c.sessions}`).slice(0, 4).join(" | "), source_type: "tool", source_ref: "conversions", month: 3, priority: "medium", impact: "high" });
    push({ key: `adv:${adv++}`, pillar: "conversions", kind: "manual", title: "שיפור חווית משתמש (UX) בעמודים המובילים", details: "בדוק CTA, טפסים, בהירות הצעת הערך ומסלול ההמרה בעמודים המובילים.", source_type: "tool", source_ref: "ux", month: 3, priority: "medium", impact: "medium" });

    if (subs.length === 0) return jsonResponse({ created: 0, pillars: 0, note: "אין מספיק נתונים לבניית תכנית. הרץ קודם מנוע המלצות/אודיט." });

    // --- Compact scheduling pass with Claude (best-effort; defaults on failure) ---
    try {
      const list = subs.map((s) => `${s.key} | ${s.pillar} | ${s.title}`).join("\n");
      const system =
        "אתה אסטרטג SEO. לפניך רשימת תתי-משימות (מפתח | עמוד-תווך | כותרת). שבץ כל אחת לתכנית 3 חודשים: " +
        "חודש 1 = ניצחונות מהירים + תשתית קריטית; חודש 2 = עומק תוכן ותוכן חדש; חודש 3 = סמכות והמרות. " +
        'החזר אך ורק JSON קומפקטי: {"schedule":{"<key>":{"month":1,"priority":"high|medium|low","impact":"high|medium|low","effort":"high|medium|low"}}}. ' +
        "התחל ישירות ב-{ ואל תוסיף טקסט.";
      const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 3000, system, messages: [{ role: "user", content: list }] });
      const parsed = extractJson(textOf(resp));
      const sched = parsed?.schedule || parsed || {};
      for (const s of subs) {
        const a = sched[s.key];
        if (a && typeof a === "object") {
          s.month = clampMonth(a.month, s.month);
          s.priority = valLevel(a.priority, s.priority);
          s.impact = valLevel(a.impact, s.impact);
          s.effort = valLevel(a.effort, s.effort);
        }
      }
    } catch (_e) { /* keep deterministic defaults */ }

    // --- Spread across actual working dates over the 3 months ---
    assignDueDates(subs);

    // --- Persist: replace previous generated plan ---
    await sb.from("tasks").delete().eq("client_id", client_id).eq("source", "plan");

    const usedPillars = PILLARS.filter((p) => subs.some((s) => s.pillar === p.key));
    const pillarId = new Map<string, number>();
    let order = 0;
    for (const p of usedPillars) {
      const { data, error } = await sb.from("tasks").insert({
        client_id, title: p.title, is_pillar: true, category: p.key, source: "plan", status: "open", sort_order: order++,
      }).select("id").single();
      if (error) throw new Error(`pillar insert: ${error.message}`);
      pillarId.set(p.key, data.id);
    }

    const rows = subs
      .sort((a, b) => a.month - b.month)
      .map((s, i) => ({
        client_id, parent_id: pillarId.get(s.pillar)!, category: s.pillar, is_pillar: false,
        title: s.title, details: s.details || null, kind: s.kind, target_month: s.month, due_date: s.due_date || null,
        writes_text: !!s.writes_text, page_url: s.page_url || null, priority: s.priority, impact: s.impact, effort: s.effort, note: s.note,
        source_type: s.source_type, source_ref: s.source_ref || null, source: "plan", status: "open", sort_order: i,
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
