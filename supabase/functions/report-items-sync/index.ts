/**
 * POST { report_id }
 * Collects every completed action for the client (applied recommendations, applied audit
 * fixes, completed manual/tool tasks) that isn't already in this report, asks Claude to write
 * a client-facing title + "why it was done & how it contributes" for each, and inserts them
 * as report_items (with a link to the specific page). Returns { added }.
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL, textOf, extractJson } from "../_shared/anthropic.ts";

const REC_AREA: Record<string, string> = {
  title_meta: "תוכן על-עמודי", improve_page: "תוכן על-עמודי", add_keywords: "תוכן על-עמודי",
  new_content: "תוכן חדש", internal_link: "קישורים פנימיים", cannibalization: "קניבליזציה",
  performance_drop: "שחזור ביצועים", technical: "טכני",
};
const PILLAR_AREA: Record<string, string> = {
  technical: "תשתית טכנית", speed: "מהירות", content: "תוכן על-עמודי", traffic: "הרחבת תנועה",
  authority: "סמכות וקישורים", conversions: "המרות ו-UX",
};

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { report_id } = await req.json();
    if (!report_id) return errorResponse("חסר report_id", 400);

    const { data: report } = await sb.from("reports").select("id, client_id, period_from, period_to").eq("id", report_id).maybeSingle();
    if (!report) return errorResponse("הדוח לא נמצא", 404);
    const client_id = report.client_id;
    const { data: client } = await sb.from("clients").select("name, domain, notes").eq("id", client_id).maybeSingle();

    // #2: only actions whose done-date falls inside this report's period belong in it.
    // Dateless actions are kept (we can't place them, and we never silently drop).
    const pf: string | null = report.period_from, pt: string | null = report.period_to;
    const inPeriod = (d?: string | null) => { if (!pf || !pt) return true; if (!d) return true; const x = String(d).slice(0, 10); return x >= pf && x <= pt; };

    const [recR, audR, taskR, linkR, existR] = await Promise.all([
      sb.from("recommendations").select("id, type, title, page, applied_at, created_at").eq("client_id", client_id).in("status", ["applied", "done"]),
      sb.from("audit_issues").select("id, issue, page, created_at").eq("client_id", client_id).eq("status", "applied"),
      sb.from("tasks").select("id, title, category, page_url, source_type, note, done_at, due_date").eq("client_id", client_id).eq("status", "done"),
      sb.from("report_links").select("id, link_type, url, notes, done_on").eq("client_id", client_id),
      sb.from("report_items").select("source_type, source_ref").eq("report_id", report_id),
    ]);

    const CONTENT_REC = new Set(["title_meta", "improve_page", "add_keywords", "new_content", "internal_link", "cannibalization"]);
    const catForPillar: Record<string, string> = { content: "תוכן באתר", traffic: "תוכן באתר", technical: "אופטימיזציה טכנית ותיקונים", speed: "אופטימיזציה טכנית ותיקונים", authority: "קישורים", conversions: "המרות ו-UX" };
    const auditCat = (issue: string) => /h1|מטא|meta|כותר|title|תוכן|content|faq|alt|תיאור/i.test(issue) ? "תוכן באתר" : "אופטימיזציה טכנית ותיקונים";

    const have = new Set((existR.data || []).map((r: any) => `${r.source_type}:${r.source_ref}`));
    type Cand = { source_type: string; source_ref: string; title: string; area: string; category: string; page: string | null; hint: string };
    const cands: Cand[] = [];
    for (const r of recR.data || []) {
      const k = `recommendation:${r.id}`; if (have.has(k)) continue;
      if (!inPeriod(r.applied_at || r.created_at)) continue;
      cands.push({ source_type: "recommendation", source_ref: String(r.id), title: r.title || "", area: REC_AREA[r.type] || "תוכן", category: CONTENT_REC.has(r.type) ? "תוכן באתר" : "אופטימיזציה טכנית ותיקונים", page: r.page, hint: r.type });
    }
    for (const a of audR.data || []) {
      const k = `audit:${a.id}`; if (have.has(k)) continue;
      if (!inPeriod(a.created_at)) continue;
      cands.push({ source_type: "audit", source_ref: String(a.id), title: a.issue || "", area: "אודיט טכני", category: auditCat(a.issue || ""), page: a.page, hint: "audit" });
    }
    for (const t of taskR.data || []) {
      if (t.source_type === "recommendation" || t.source_type === "audit") continue;
      const k = `task:${t.id}`; if (have.has(k)) continue;
      if (!inPeriod(t.done_at || t.due_date)) continue;
      cands.push({ source_type: "task", source_ref: String(t.id), title: t.title || "", area: PILLAR_AREA[t.category || ""] || "משימה", category: catForPillar[t.category || ""] || "אחר", page: t.page_url, hint: t.note || "" });
    }
    for (const l of linkR.data || []) {
      const k = `link:${l.id}`; if (have.has(k)) continue;
      if (!inPeriod(l.done_on)) continue;
      cands.push({ source_type: "link", source_ref: String(l.id), title: `בניית קישור: ${l.link_type}`, area: "קישורים נכנסים", category: "קישורים", page: l.url, hint: l.notes || "" });
    }
    const batch = cands.slice(0, 40);
    if (batch.length === 0) return jsonResponse({ added: 0, note: "אין פעולות חדשות להוספה." });

    // Client-facing title + why for each.
    const system =
      "אתה כותב דוח קידום אורגני ללקוח. לכל פעולה שבוצעה, כתוב כותרת קצרה וברורה ללקוח, " +
      "והסבר קצר (1-2 משפטים) למה הפעולה בוצעה ואיך היא תורמת לקידום האתר ולעסק — בשפה ללקוח, לא טכנית מדי, חיובית ומקצועית. " +
      'החזר אך ורק JSON: {"items":[{"title":"...","why":"..."}]} — באותו סדר ומספר של הפעולות שסופקו. התחל ישירות ב-{.';
    const userMsg =
      `עסק: ${client?.name || ""} (${client?.domain || ""}). ${client?.notes ? `רקע: ${client.notes}` : ""}\n\nפעולות שבוצעו:\n` +
      batch.map((c, i) => `${i + 1}. [${c.area}] ${c.title}${c.page ? ` | עמוד: ${c.page}` : ""}${c.hint ? ` | הקשר: ${String(c.hint).slice(0, 120)}` : ""}`).join("\n");

    let items: any[] = [];
    try {
      const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 4000, system, messages: [{ role: "user", content: userMsg }] });
      const parsed = extractJson(textOf(resp));
      items = Array.isArray(parsed) ? parsed : (parsed.items || []);
    } catch { /* fall back to raw titles */ }

    const { data: maxRow } = await sb.from("report_items").select("sort_order").eq("report_id", report_id).order("sort_order", { ascending: false }).limit(1).maybeSingle();
    let order = (maxRow?.sort_order ?? -1) + 1;

    const rows = batch.map((c, i) => ({
      report_id, client_id,
      title: (items[i]?.title || c.title || "פעולה").toString().slice(0, 300),
      why: (items[i]?.why || "").toString().slice(0, 1000) || null,
      page_url: c.page || null, category: c.category,
      source_type: c.source_type, source_ref: c.source_ref,
      sort_order: order++,
    }));
    const { error } = await sb.from("report_items").upsert(rows, { onConflict: "report_id,source_type,source_ref", ignoreDuplicates: true });
    if (error) throw new Error(error.message);

    // Backfill AI "why" for items missing it (e.g. auto-logged raw items).
    let backfilled = 0;
    const { data: missing } = await sb.from("report_items").select("id, title, page_url").eq("report_id", report_id).is("why", null).limit(40);
    if (missing && missing.length) {
      try {
        const sys = "אתה כותב דוח קידום ללקוח. לכל פעולה, כתוב הסבר קצר (1-2 משפטים) למה היא בוצעה ואיך היא תורמת לקידום ולעסק — בשפה ללקוח, חיובית ומקצועית. " +
          'החזר אך ורק JSON: {"items":[{"why":"..."}]} באותו סדר. התחל ישירות ב-{.';
        const um = `עסק: ${client?.name || ""}.\n\nפעולות:\n` + missing.map((m: any, i: number) => `${i + 1}. ${m.title}${m.page_url ? ` | ${m.page_url}` : ""}`).join("\n");
        const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 3000, system: sys, messages: [{ role: "user", content: um }] });
        const parsed = extractJson(textOf(resp));
        const whys: any[] = Array.isArray(parsed) ? parsed : (parsed.items || []);
        for (let i = 0; i < missing.length; i++) {
          const why = (whys[i]?.why || "").toString().slice(0, 1000);
          if (why) { await sb.from("report_items").update({ why }).eq("id", missing[i].id); backfilled++; }
        }
      } catch { /* leave as-is */ }
    }

    return jsonResponse({ added: rows.length, backfilled });
  } catch (e) {
    return errorResponse(`שגיאה בהוספת פעולות לדוח: ${(e as Error).message}`, 500);
  }
});
