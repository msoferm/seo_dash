/**
 * "ביטויי יעד ועמודי יעד" AI consultant. POST { client_id, from, to, messages: [{role, content}] }
 * Loads a full snapshot of the client's site-structure data (GSC keyword→page map, target
 * decisions, secondary keywords, user-intent analyses, crawled page titles/H1, cannibalization)
 * into a cached system prompt, and lets Claude drill into the long tail with lookup tools.
 * Stateless: the frontend keeps the conversation and sends it with each call. Read-only.
 * action "analyze" + stage: the combined analysis, one stage per request (orchestrated by the UI):
 *   map → every keyword into an intent cluster; hierarchy → hubs/children site map with alternatives;
 *   recs (hub_id | "SITE") → recommendations with structured considerations. Saved in structure_ai_analysis.
 * action "rec_intent": detailed user intent for one recommendation's keyword group.
 * The chat sees the latest analysis and can add a recommendation to it (propose_recommendation).
 * Keywords = GSC page↔query map (every keyword, no impressions floor) + keywords that exist only in
 * uploaded files (no page data), minus keywords the team removed (excluded_keywords).
 * Big hubs are analysed in parts ("H1.0", "H1.1" … CHILDREN_PER_PART children each) so every request
 * stays well under the edge-function time limit.
 * rev: 2026-11-13a
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { FRAMEWORK } from "../_shared/intent_framework.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL, textOf, extractJson, type Message, type ToolDefinition } from "../_shared/anthropic.ts";

const MAX_KW_IN_SNAPSHOT = 700;   // keywords listed in the system prompt (by impressions)
const MAX_PAGES_PER_KW = 5;
const CHILDREN_PER_PART = 4;       // must match the UI (StructureAiPlan.unitIds)

type Row = { page: string; term: string; clicks: number; impressions: number; ctr: number; position: number };
interface KwAgg { term: string; impressions: number; clicks: number; best: number; pages: Row[]; file?: { impressions: number; position: number | null; files: string[] } }

const norm = (u: string) => (u || "").replace(/\/+$/, "").toLowerCase();
function decodePath(u: string): string {
  try { return decodeURIComponent(u.replace(/^https?:\/\/[^/]+/, "")) || u; } catch { return u; }
}

const TOOLS: ToolDefinition[] = [
  {
    name: "search_keywords",
    description: "חיפוש מילות מפתח בכל נתוני Search Console של הלקוח (כולל מילים שלא נכנסו לתמונת המצב). מחזיר לכל מילה את כל העמודים שמדורגים עליה עם מיקום, חשיפות וקליקים, והחלטת היעד שלה.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "טקסט לחיפוש (חלק ממילת המפתח)" }, limit: { type: "number" } }, required: ["query"] },
  },
  {
    name: "get_page",
    description: "כל הנתונים על עמוד אחד: כל מילות המפתח שמדורגות עליו (מיקום/חשיפות/קליקים), ביטויי היעד והמשנה שהוגדרו לו, title/H1/meta, וניתוח כוונת המשתמש המלא שנשמר.",
    input_schema: { type: "object", properties: { page: { type: "string", description: "מזהה עמוד (למשל P12) או כתובת URL / חלק מהנתיב" } }, required: ["page"] },
  },
];
// Chat-only tools — keep the chat and the combined analysis in sync.
const CHAT_TOOLS: ToolDefinition[] = [
  {
    name: "get_recommendation",
    description: "הפרטים המלאים של המלצה מהניתוח הכולל לפי המפתח שלה (key): שיקולים, מילים, עמודים, פעולות, והאם כבר אושרה.",
    input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
  {
    name: "propose_recommendation",
    description: "הוסף המלצה חדשה לרשימת ההמלצות של הניתוח הכולל (המשתמש יוכל לקבל/לדחות אותה שם). השתמש רק כשהמשתמש מבקש להפוך רעיון מהשיחה להמלצה, או כשהגעתם יחד למסקנה ברורה. השתמש במזהי עמודים (P..) ב-pages וב-actions.target, ו-new לעמוד חדש.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["same_intent", "cannibalization", "relocate", "unassigned", "new_page", "site_strategy"] },
        title: { type: "string" }, summary: { type: "string" },
        considerations: { type: "object", properties: { facts: { type: "array", items: { type: "string" } }, intent: { type: "string" }, options: { type: "array", items: { type: "object", properties: { option: { type: "string" }, pros: { type: "string" }, cons: { type: "string" }, chosen: { type: "boolean" } } } }, risks: { type: "string" }, why: { type: "string" } } },
        keywords: { type: "array", items: { type: "string" } }, pages: { type: "array", items: { type: "string" } },
        actions: { type: "array", items: { type: "object", properties: { keyword: { type: "string" }, target: { type: "string" } }, required: ["keyword", "target"] } },
        extra_steps: { type: "string" }, new_page_title: { type: "string" }, priority: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["type", "title", "summary"],
    },
  },
];

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const body = await req.json();
    const { client_id, from, to } = body;
    const analyze = body.action === "analyze";
    const convo: { role: string; content: string }[] = Array.isArray(body.messages) ? body.messages : [];
    if (body.action !== "rec_intent" && (!client_id || !from || !to || (!analyze && convo.length === 0))) return errorResponse("חסר client_id / טווח תאריכים / הודעה", 400);

    const { data: client } = await sb.from("clients").select("name, domain, notes").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);

    // Detailed user intent for one recommendation's keyword group (same framework as "כוונת המשתמש").
    if (body.action === "rec_intent") {
      const rec = body.rec || {};
      const kws: string[] = (rec.keywords || []).slice(0, 40);
      const lines: string[] = (body.lines || []).slice(0, 60);
      const sys = "אתה אסטרטג SEO ותוכן בעברית. נתח לעומק את כוונת המשתמש מאחורי קבוצת מילות מפתח שהומלץ לטפל בה יחד. אם יש בקבוצה מילים עם כוונה שונה — ציין אותן במפורש והסבר את ההשלכה (אולי צריך לפצל). כתוב בעברית, עם כותרות קצרות לכל שאלה, בלי מלל מיותר. ציין עמודים לפי הנתיב שלהם.";
      const msg = `עסק: ${client.name} (${client.domain}). ${client.notes ? `הערות: ${client.notes}` : ""}\n\nההמלצה: ${rec.title || ""}\nנימוק: ${rec.explanation || ""}\n\nמילות המפתח בקבוצה: ${kws.join(", ") || "—"}\n` +
        (lines.length ? `\nנתוני חיפוש (מילה | חשיפות | עמודים מדורגים עם מיקום):\n${lines.join("\n")}\n` : "") +
        `\n${FRAMEWORK}\n\nבסיום: סכם ב-2-3 משפטים "מי המשתמש ומה הוא צריך", ומה העמוד שמשרת את הקבוצה הזו חייב לכלול כדי לענות על הכוונה.`;
      const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 3000, system: sys, messages: [{ role: "user", content: msg }] });
      return jsonResponse({ intent_analysis: textOf(resp).trim() });
    }

    // ---- Load everything ----
    const rows: Row[] = [];
    for (let off = 0; off < 100000; off += 1000) {
      const { data, error } = await sb.rpc("gsc_page_query_map", { p_client_id: client_id, p_from: from, p_to: to, p_min_impr: 1 }).range(off, off + 999);
      if (error) throw error;
      for (const r of data || []) rows.push({ page: r.page, term: r.term, clicks: +r.clicks || 0, impressions: +r.impressions || 0, ctr: +r.ctr || 0, position: +r.position || 0 });
      if (!data || data.length < 1000) break;
    }
    const [{ data: targets }, { data: secondary }, { data: intents }, { data: crawled }, { data: written }] = await Promise.all([
      sb.from("keyword_targets").select("keyword, page_url, intent, status, notes").eq("client_id", client_id),
      sb.from("page_keywords").select("page_url, keyword").eq("client_id", client_id),
      sb.from("page_intent").select("page_url, intent_analysis, conclusions, quality_score, saved_summary, primary_keywords, secondary_keywords").eq("client_id", client_id),
      sb.from("pages").select("url, title, h1, meta_description, content_text, text_scanned_at").eq("client_id", client_id).not("last_full_crawl", "is", null),
      sb.from("kw_written").select("keyword, written_url").eq("client_id", client_id),
    ]);
    const [{ data: excludedRows }, { data: fileKwRows }] = await Promise.all([
      sb.from("excluded_keywords").select("keyword").eq("client_id", client_id),
      sb.rpc("uploaded_keywords", { p_client_id: client_id }),
    ]);
    const excluded = new Set((excludedRows || []).map((e: any) => String(e.keyword).trim().toLowerCase()));
    for (let i = rows.length - 1; i >= 0; i--) if (excluded.has(rows[i].term.trim().toLowerCase())) rows.splice(i, 1);
    const { data: decisions } = await sb.from("structure_decisions").select("title, keywords, note, rec_key").eq("client_id", client_id).order("created_at");
    const { data: analysisRow } = await sb.from("structure_ai_analysis").select("hierarchy, recs, created_at").eq("client_id", client_id).maybeSingle();
    const acceptedKeys = new Set((decisions || []).map((d: any) => d.rec_key));
    const scanDate = (crawled || []).map((p: any) => p.text_scanned_at).filter(Boolean).sort().pop() || null;

    // ---- Page registry (short ids keep the prompt compact) ----
    const pageId = new Map<string, string>();
    const pageUrl = new Map<string, string>();
    const idOf = (u: string) => {
      const k = norm(u);
      if (!pageId.has(k)) { const id = `P${pageId.size + 1}`; pageId.set(k, id); pageUrl.set(id, u); }
      return pageId.get(k)!;
    };
    const crawlByUrl = new Map<string, any>();
    for (const p of crawled || []) crawlByUrl.set(norm(p.url), p);
    const intentByUrl = new Map<string, any>();
    for (const p of intents || []) intentByUrl.set(norm(p.page_url), p);
    const targetByKw = new Map<string, any>();
    for (const t of targets || []) targetByKw.set(t.keyword, t);
    const secByUrl = new Map<string, string[]>();
    for (const s of secondary || []) { const k = norm(s.page_url); secByUrl.set(k, [...(secByUrl.get(k) || []), s.keyword]); }

    // ---- Aggregate per keyword ----
    const byKw = new Map<string, KwAgg>();
    const byPage = new Map<string, Row[]>();
    for (const r of rows) {
      const a = byKw.get(r.term) || { term: r.term, impressions: 0, clicks: 0, best: 999, pages: [] };
      a.impressions += r.impressions; a.clicks += r.clicks; a.best = Math.min(a.best, r.position || 999); a.pages.push(r);
      byKw.set(r.term, a);
      const pk = norm(r.page);
      byPage.set(pk, [...(byPage.get(pk) || []), r]);
    }
    // Keywords from uploaded files: enrich known ones, add the ones with no page data at all.
    const byLower = new Map([...byKw.values()].map((k) => [k.term.trim().toLowerCase(), k]));
    for (const f of fileKwRows || []) {
      const low = String(f.term || "").trim().toLowerCase();
      if (!low || excluded.has(low)) continue;
      const file = { impressions: +f.impressions || 0, position: f.position == null ? null : +f.position, files: f.files || [] };
      const cur = byLower.get(low);
      if (cur) cur.file = file;
      else { const a: KwAgg = { term: String(f.term).trim(), impressions: file.impressions, clicks: +f.clicks || 0, best: file.position ?? 999, pages: [], file }; byKw.set(a.term, a); byLower.set(low, a); }
    }
    const kws = [...byKw.values()].sort((a, b) => b.impressions - a.impressions);
    for (const k of kws) k.pages.sort((a, b) => b.impressions - a.impressions);
    // Register pages in order of total impressions so the busiest pages get the lowest ids.
    [...byPage.entries()].sort((a, b) => b[1].reduce((s, r) => s + r.impressions, 0) - a[1].reduce((s, r) => s + r.impressions, 0))
      .forEach(([, rs]) => idOf(rs[0].page));
    for (const t of targets || []) if (t.page_url) idOf(t.page_url);
    for (const s of secondary || []) idOf(s.page_url);
    for (const p of intents || []) idOf(p.page_url);
    for (const p of crawled || []) idOf(p.url); // indexed/crawled pages with no search data yet

    const targetLabel = (term: string) => {
      const t = targetByKw.get(term);
      if (!t) return "";
      if (t.status === "parked") return " | החלטה: בצד";
      if (t.intent === "new_page" && !t.page_url) return " | החלטה: עמוד חדש";
      return ` | יעד: ${t.page_url ? idOf(t.page_url) : "—"}${t.intent === "new_page" ? " (עמוד חדש)" : ""}`;
    };
    const kwLine = (k: KwAgg, maxPages = MAX_PAGES_PER_KW) => {
      const ps = k.pages.slice(0, maxPages).map((r) => `${idOf(r.page)}(מ${r.position},ח${r.impressions},ק${r.clicks})`).join(" ");
      const more = k.pages.length > maxPages ? ` +${k.pages.length - maxPages}` : "";
      const fileNote = !k.pages.length && k.file ? `מקובץ שהועלה בלבד (מ${k.file.position ?? "?"}) — אין נתון על איזה עמוד מדורג` : "";
      return `${k.term} | ח${k.impressions} ק${k.clicks} | ${ps || fileNote}${more}${targetLabel(k.term)}`;
    };

    // ---- Snapshot text ----
    const pageLines = [...pageUrl.entries()].map(([id, u]) => {
      const c = crawlByUrl.get(norm(u));
      const tot = (byPage.get(norm(u)) || []).reduce((s, r) => s + r.impressions, 0);
      const bits = [`${id} = ${decodePath(u)}`];
      if (c?.title) bits.push(`title: ${c.title}`);
      if (c?.h1 && c.h1 !== c.title) bits.push(`H1: ${c.h1}`);
      bits.push(`ח${tot}`);
      return bits.join(" | ");
    });
    const targetLines = (targets || []).map((t: any) =>
      `${t.keyword} → ${t.status === "parked" ? "בצד" : t.page_url ? idOf(t.page_url) : "עמוד חדש (טרם נכתב)"}${t.notes ? ` | הערה: ${t.notes}` : ""}`);
    const secLines = [...secByUrl.entries()].map(([k, list]) => `${pageId.get(k) || k}: ${list.join(", ")}`);
    const intentLines = (intents || []).map((p: any) => {
      const txt = (p.saved_summary || p.intent_analysis || "").replace(/\s+/g, " ").trim().slice(0, 700);
      const concl = (p.conclusions || "").replace(/\s+/g, " ").trim().slice(0, 300);
      return `${idOf(p.page_url)}${p.quality_score ? ` (ציון ${p.quality_score}/10)` : ""}: ${txt}${concl ? ` | מסקנות: ${concl}` : ""}`;
    });
    const cannibal = kws.filter((k) => k.pages.length > 1 && k.pages[1].impressions >= 5).slice(0, 150);
    const decisionLines = (decisions || []).map((d: any) => `${d.title} | מילים: ${(d.keywords || []).join(", ")}${d.note ? ` | הערת צוות: ${d.note}` : ""}`);
    // Page text from the site scan — an excerpt per page within a total budget (full text via get_page).
    const withText = (crawled || []).filter((p: any) => p.content_text);
    const perPage = Math.max(400, Math.min(1500, Math.floor(60000 / Math.max(1, withText.length))));
    const textLines = withText.map((p: any) => `${idOf(p.url)}: ${String(p.content_text).slice(0, perPage)}${p.content_text.length > perPage ? "…" : ""}`);
    const writtenLines = (written || []).map((w: any) => `${w.keyword}${w.written_url ? ` → ${decodePath(w.written_url)}` : ""}`);

    const snapshot = [
      `=== עמודים (מזהה = נתיב | title | H1 | סה"כ חשיפות) — ${pageUrl.size} ===`, ...pageLines,
      `\n=== מילות מפתח מ-Search Console (${from} עד ${to}) — ${kws.length} סה"כ, מוצגות ${Math.min(kws.length, MAX_KW_IN_SNAPSHOT)} המובילות בחשיפות ===`,
      `פורמט: מילה | ח=חשיפות ק=קליקים | עמודים מדורגים: מזהה(מ=מיקום ממוצע, ח, ק) | החלטת יעד. מילים "מקובץ שהועלה בלבד" הגיעו מקובץ Search Console שהועלה (ללא פילוח לפי עמוד) — הנתונים שלהן מצטברים לתקופת הקובץ.`,
      ...kws.slice(0, MAX_KW_IN_SNAPSHOT).map((k) => kwLine(k)),
      `\n=== קניבליזציה: מילים שיותר מעמוד אחד מדורג עליהן (${cannibal.length}) ===`,
      ...cannibal.map((k) => kwLine(k, 8)),
      `\n=== החלטות ביטוי יעד → עמוד יעד (לשונית "ביטויי יעד ועמודי יעד") — ${targetLines.length} ===`, ...(targetLines.length ? targetLines : ["אין עדיין"]),
      `\n=== ביטויי משנה שהוגדרו לעמודים ===`, ...(secLines.length ? secLines : ["אין עדיין"]),
      `\n=== ניתוחי כוונת משתמש שנשמרו (לשונית "כוונת המשתמש") ===`, ...(intentLines.length ? intentLines : ["אין עדיין"]),
      `\n=== החלטות מבנה שהצוות כבר אישר מניתוחי AI קודמים (אל תמליץ עליהן שוב) ===`, ...(decisionLines.length ? decisionLines : ["אין"]),
      `\n=== מילים שסומנו "נכתב" (לשונית "מילים ללא עמוד") ===`, ...(writtenLines.length ? writtenLines : ["אין"]),
      `\n=== תוכן העמודים (${scanDate ? `מסריקת דפי האתר מ-${String(scanDate).slice(0, 10)}` : "לא בוצעה סריקת טקסטים — יש רק title/H1"}) ===`,
      ...(textLines.length ? textLines : ["אין טקסט שמור"]),
      // The chat sees the latest combined analysis so both stay in sync (not used by the analysis stages themselves).
      ...(!analyze && analysisRow ? [
        `\n=== הניתוח הכולל האחרון (${String(analysisRow.created_at || "").slice(0, 10)}) — מפת האתר ===`,
        ...((analysisRow.hierarchy?.hubs || []) as any[]).map((h) => `${h.name} → ${h.page_url ? decodePath(h.page_url) : `עמוד חדש "${h.new_title}"`}; בנים: ${(h.children || []).map((c: any) => `${c.name} → ${c.page_url ? decodePath(c.page_url) : `חדש "${c.new_title}"`}`).join(", ") || "—"}`),
        `=== המלצות הניתוח (key | סוג | כותרת | מצב) — לפרטים get_recommendation ===`,
        ...((analysisRow.recs || []) as any[]).map((r) => `${r.key} | ${r.type} | ${r.title} | ${acceptedKeys.has(r.key) ? "אושרה" : "פתוחה"}`),
      ] : []),
    ].join("\n");

    const system = [
      {
        type: "text" as const,
        text:
          "אתה יועץ SEO בכיר בעברית, ובו בזמן אסטרטג שיווקי ומומחה לארכיטקטורת אתר היררכית: שיוך מילות מפתח לעמודים, כוונת משתמש, קיבוץ מילים לעמוד אחד מול פיצול לעמודים נפרדים, מניעת קניבליזציה, עמודי עוגן ואשכולות, וקישוריות פנימית — במטרה למקסם חשיפות וכניסות מגוגל לטווח הארוך. " +
          "חשוב אסטרטגית: מילה שכבר מדורגת היא נכס — שקול סיכון מול רווח לפני שמזיזים אותה; מילה בלי עמוד לא תמיד מצדיקה עמוד חדש — הכרע לפי כוונה, פוטנציאל וערך עסקי. " +
          "לרשותך תמונת מצב מלאה של נתוני הלקוח (למטה). התבסס עליה ועל הכלים — אל תמציא מספרים, עמודים או מילים. " +
          "למילים שלא מופיעות בתמונת המצב השתמש ב-search_keywords; לפרטים מלאים על עמוד (כולל ניתוח כוונה מלא) השתמש ב-get_page.\n" +
          "כללים לשיוך מילים לעמוד: מילים עם אותה כוונת משתמש (אותו צורך, אותו שלב במסע, אותה תשובה מצופה) — באותו עמוד; כוונה שונה (מידע מול רכישה, מוצר שונה, קהל שונה) — עמודים נפרדים. " +
          "רמז חזק לכוונה זהה: גוגל כבר מדרג את אותו עמוד על שתי המילים. קניבליזציה: כמה עמודים של האתר מתחרים על אותה מילה ומפצלים חשיפות/מיקום. " +
          "כשאתה ממליץ — נמק (חשיפות, מיקום, איזה עמוד חזק יותר, כוונה), ציין עמודים תמיד לפי הנתיב או ה-title שלהם — לעולם אל תכתוב למשתמש מזהים כמו P8 (הם קיצור פנימי בלבד ואינם מוכרים לו), והבחן בין עובדה מהנתונים לבין הערכה שלך. " +
          "ענה בעברית, ממוקד וברור. אתה רק מייעץ — אינך משנה דבר באתר או במערכת.\n" +
          "עיצוב התשובה (חובה, כדי שיהיה קל לקרוא): כותרות קצרות עם ##, רשימות עם -, **הדגשה** למסקנות ולמספרים החשובים, שורה ריקה בין חלקים, וטבלת מרקדאון (| עמודה | עמודה |) כשמשווים כמה עמודים או מילים. " +
          "כשאתה מזכיר עמוד — כתוב את הנתיב שלו (למשל /matrix/זיווד-לרכב-מסחרי-קטן/) והמערכת תהפוך אותו לקישור. כשאתה ממליץ — הפרד בין 'מה הנתונים מראים', 'השיקולים' ו'ההמלצה'.\n\n" +
          `לקוח: ${client.name} (${client.domain}).${client.notes ? ` הערות על העסק: ${client.notes}` : ""}\n\n${snapshot}`,
        cache_control: { type: "ephemeral" as const },
      },
    ];

    // Internal page ids (P8) must never reach the user: swap any that slip through for the page path,
    // and collapse the "path (path)" duplicates that appear when the model wrote "P8 (path)".
    const unId = (t: string) => String(t || "")
      .replace(/\bP(\d+)\b/g, (m) => { const u = pageUrl.get(m); return u ? decodePath(u) : m; })
      .replace(/(\/[^\s()]+)\s*\(\1\)/g, "$1");

    // ---- Shared helpers: keyword/page resolution, robust JSON parsing, rec normalization ----
    const kwKey = (k: string) => String(k || "").replace(/["'״׳]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    const kwByKey = new Map<string, string>();
    for (const k of byKw.keys()) kwByKey.set(kwKey(k), k);
    const realKw = (k: unknown) => kwByKey.get(kwKey(String(k))) || null;
    const resolve = (t: unknown) => {
      const s = String(t || "").trim();
      const byId = pageUrl.get(s.toUpperCase()); if (byId) return byId;
      if (!s || s.toLowerCase() === "new") return null;
      const n = norm(s).replace(/^https?:\/\/[^/]+/, "");
      return [...pageUrl.values()].find((u) => norm(u) === norm(s) || norm(decodePath(u)) === norm(decodePath(n))) || null;
    };
    /** Parse {"<key>":[...]} — if the answer was cut off, keep every array item that did complete. */
    const parseObj = (text: string, key: string): any[] => {
      try { const j = extractJson(text); if (Array.isArray(j?.[key])) return j[key]; if (Array.isArray(j)) return j; } catch { /* salvage below */ }
      const i = text.indexOf("["); if (i < 0) return [];
      const out: any[] = []; let depth = 0, objStart = -1, inStr = false, esc = false;
      for (let k = i + 1; k < text.length; k++) {
        const ch = text[k];
        if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === "{") { if (depth === 0) objStart = k; depth++; }
        else if (ch === "}") { depth--; if (depth === 0 && objStart >= 0) { try { out.push(JSON.parse(text.slice(objStart, k + 1))); } catch { /* skip */ } objStart = -1; } }
      }
      return out;
    };
    const callWithRetry = async (content: string, maxTokens = 8000) => {
      for (let attempt = 0; ; attempt++) {
        try { return await callClaude({ model: DEFAULT_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }); }
        catch (e) {
          const msg = (e as Error).message || "";
          if (attempt < 2 && /(429|529|500|503|overloaded|rate)/i.test(msg)) { await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); continue; }
          throw e;
        }
      }
    };
    const REC_TYPES = ["same_intent", "cannibalization", "relocate", "unassigned", "new_page", "site_strategy"];
    const normalizeRec = (r: any, key: string, hub: string) => {
      const actions = (Array.isArray(r.actions) ? r.actions : [])
        .map((a: any) => ({ a, kw: realKw(a?.keyword) })).filter((x: any) => x.kw)
        .map(({ a, kw }: any) => { const u = resolve(a.target); return { keyword: kw, page_url: u, intent: u ? "strengthen" : "new_page" }; });
      const keywords = [...new Set([...(r.keywords || []).map(realKw), ...actions.map((a: any) => a.keyword)].filter(Boolean))] as string[];
      const pages = [...new Set([...(r.pages || []).map(resolve), ...actions.map((a: any) => a.page_url)].filter(Boolean))] as string[];
      const c = r.considerations || {};
      return {
        key, type: REC_TYPES.includes(r.type) ? r.type : "site_strategy", hub,
        title: unId(r.title), explanation: unId(r.summary || r.explanation || ""),
        considerations: {
          facts: (Array.isArray(c.facts) ? c.facts : []).map((f: any) => unId(String(f))), intent: unId(c.intent || ""),
          options: (Array.isArray(c.options) ? c.options : []).map((o: any) => ({ option: unId(o.option || ""), pros: unId(o.pros || ""), cons: unId(o.cons || ""), chosen: !!o.chosen })),
          risks: unId(c.risks || ""), why: unId(c.why || ""),
        },
        extra_steps: unId(r.extra_steps || ""), new_page_title: r.new_page_title || "",
        priority: ["high", "medium", "low"].includes(r.priority) ? r.priority : "medium", keywords, pages, actions,
      };
    };

    const proposed: string[] = [];
    const runTool = async (name: string, input: any): Promise<unknown> => {
      if (name === "search_keywords") {
        const q = String(input.query || "").trim();
        const lim = Math.min(Number(input.limit) || 40, 100);
        const hits = kws.filter((k) => k.term.includes(q)).slice(0, lim);
        return { total_matches: kws.filter((k) => k.term.includes(q)).length, keywords: hits.map((k) => kwLine(k, 20)) };
      }
      if (name === "get_page") {
        const p = String(input.page || "").trim();
        let url = pageUrl.get(p.toUpperCase());
        if (!url) {
          const needle = norm(p).replace(/^https?:\/\/[^/]+/, "");
          url = [...pageUrl.values()].find((u) => norm(u) === norm(p)) || [...pageUrl.values()].find((u) => decodePath(u).toLowerCase().includes(decodePath(needle)) || norm(u).includes(needle));
        }
        if (!url) return { found: false };
        const k = norm(url);
        const c = crawlByUrl.get(k);
        const it = intentByUrl.get(k);
        return {
          found: true, id: pageId.get(k), url, path: decodePath(url),
          title: c?.title || null, h1: c?.h1 || null, meta: c?.meta_description || null,
          page_text: c?.content_text ? String(c.content_text).slice(0, 6000) : "לא נסרק טקסט לעמוד זה",
          target_keywords: (targets || []).filter((t: any) => t.page_url && norm(t.page_url) === k).map((t: any) => t.keyword),
          secondary_keywords: secByUrl.get(k) || [],
          ranking_keywords: (byPage.get(k) || []).sort((a, b) => b.impressions - a.impressions).slice(0, 150)
            .map((r) => `${r.term} (מ${r.position}, ח${r.impressions}, ק${r.clicks}, ${(byKw.get(r.term)?.pages.length || 1) > 1 ? "מדורגים עליה עוד עמודים" : "רק עמוד זה"})`),
          user_intent: it ? { intent_analysis: it.intent_analysis, page_analysis_conclusions: it.conclusions, quality_score: it.quality_score, summary: it.saved_summary } : null,
        };
      }
      if (name === "get_recommendation") {
        const r = (analysisRow?.recs || []).find((x: any) => x.key === String(input.key || ""));
        return r ? { ...r, accepted: acceptedKeys.has(r.key) } : { found: false };
      }
      if (name === "propose_recommendation") {
        const rec = normalizeRec(input, `chat-${Date.now().toString(36)}`, "מהשיחה");
        if (!rec.title) return { added: false, error: "חסרה כותרת" };
        const { data: row } = await sb.from("structure_ai_analysis").select("recs").eq("client_id", client_id).maybeSingle();
        if (row) await sb.from("structure_ai_analysis").update({ recs: [...(row.recs || []), rec] }).eq("client_id", client_id);
        else await sb.from("structure_ai_analysis").insert({ client_id, recs: [rec], date_from: from, date_to: to, stage: "chat" });
        proposed.push(rec.key);
        return { added: true, key: rec.key, note: "ההמלצה נוספה לרשימת ההמלצות; המשתמש יכול לקבל/לדחות אותה שם." };
      }
      return { error: "כלי לא מוכר" };
    };


    if (analyze) {
      // Staged, exhaustive analysis (each stage is its own request, orchestrated by the UI):
      //   map       → every keyword into exactly one intent cluster (nothing skipped)
      //   hierarchy → the site map: hubs (parent pages) → children, with alternatives weighed
      //   recs      → per hub (or "SITE"): concrete recommendations with structured considerations
      const stage = String(body.stage || "map");
      const { data: cur } = await sb.from("structure_ai_analysis").select("*").eq("client_id", client_id).maybeSingle();

      if (stage === "map") {
        const listed = kws.slice(0, MAX_KW_IN_SNAPSHOT).map((k) => k.term);
        const ask =
          `שלב 1 — מיפוי מלא. סווג את כל ${listed.length} מילות המפתח שבנתונים לקבוצות לפי כוונת משתמש. כל מילה חייבת להופיע בדיוק בקבוצה אחת — אל תדלג על אף מילה. ` +
          "קבוצה = מילים שמשתמש שמחפש אותן מצפה לאותה תשובה/אותו עמוד (אותו צורך, אותו מוצר/שירות, אותו שלב במסע). מילים כלליות (גג) וממוקדות (למשל לפי גודל/דגם) — בקבוצות נפרדות. " +
          'החזר JSON בלבד: {"clusters":[{"id":"C1","name":"<שם קצר לקבוצה>","intent":"<משפט אחד: מי מחפש ומה הוא רוצה>","stage":"מידע|השוואה|רכישה|ניווט","keywords":["<מילה בדיוק כפי שהיא בנתונים>"]}]}';
        const resp = await callWithRetry(ask, 14000);
        const parsed = parseObj(textOf(resp), "clusters");
        const used = new Set<string>();
        const clusters = parsed.map((c: any, i: number) => {
          const keywords = [...new Set((c.keywords || []).map(realKw).filter((k: string | null) => k && !used.has(k)))] as string[];
          keywords.forEach((k) => used.add(k));
          return { id: String(c.id || `C${i + 1}`), name: String(c.name || ""), intent: String(c.intent || ""), stage: String(c.stage || ""), keywords };
        }).filter((c: any) => c.keywords.length);
        const missing = listed.filter((k) => !used.has(k));
        if (missing.length) clusters.push({ id: "C_OTHER", name: "לא סווגו", intent: "מילים שה-AI לא שייך לקבוצה — כדאי לבדוק ידנית", stage: "", keywords: missing });
        const map = { clusters, total: kws.length, mapped: used.size, missing: missing.length, stop: resp.stop_reason, scan_date: scanDate };
        await sb.from("structure_ai_analysis").upsert({ client_id, map, hierarchy: null, recs: [], stage: "map", date_from: from, date_to: to, created_at: new Date().toISOString(), debug: null });
        return jsonResponse({ map });
      }

      const clusters: any[] = cur?.map?.clusters || [];
      const clusterText = (c: any) => `${c.id} "${c.name}" (${c.stage || "—"}) — ${c.intent}\n  מילים: ${c.keywords.map((k: string) => { const a = byKw.get(k); return a ? `${k} [ח${a.impressions}${a.pages[0] ? `, ${idOf(a.pages[0].page)} מ${a.pages[0].position}` : ""}${a.pages.length > 1 ? `, ${a.pages.length} עמודים` : ""}]` : k; }).join("; ")}`;

      if (stage === "hierarchy") {
        if (!clusters.length) return errorResponse("חסר שלב המיפוי — הרץ ניתוח מחדש", 400);
        const ask =
          "שלב 2 — מפת אתר היררכית. על בסיס קבוצות הכוונה למטה, הנתונים ותוכן העמודים, בנה את המבנה האידיאלי של האתר: עמודי אב (hub / עמוד עוגן) ומתחתם עמודי בן. " +
          "לכל קבוצה קבע לאיזה עמוד היא שייכת — עמוד קיים (לפי מזהה) או עמוד חדש. כל קבוצה חייבת להופיע פעם אחת במפה. " +
          "כשיש יותר מדרך סבירה אחת (למשל: להשתמש בעמוד קיים חזק כעמוד אב מול לפתוח עמוד אב חדש וממוקד) — פרט את החלופות עם יתרונות וחסרונות וסמן את המומלצת. " +
          "שקול: מילים שכבר מדורגות הן נכס (סיכון בהזזה), עומק קליקים, קישוריות פנימית, וערך עסקי.\n\n" +
          `קבוצות הכוונה:\n${clusters.map(clusterText).join("\n")}\n\n` +
          'החזר JSON בלבד: {"hubs":[{"id":"H1","name":"<שם עמוד האב>","page":"<מזהה עמוד קיים או new>","new_title":"<רק אם new>","clusters":["C1"],"why":"<למה זה עמוד האב — בקצרה, עם נתונים>",' +
          '"children":[{"name":"<שם עמוד הבן>","page":"<מזהה או new>","new_title":"<רק אם new>","clusters":["C2"],"why":"<למה>"}],' +
          '"alternatives":[{"option":"<חלופה>","pros":"<יתרונות>","cons":"<חסרונות>","recommended":true}]}],"notes":"<הערות כלליות על המבנה, במרקדאון קצר>"}';
        const resp = await callWithRetry(ask, 12000);
        const j = (() => { try { return extractJson(textOf(resp)); } catch { return null; } })();
        if (!j?.hubs) return errorResponse("ה-AI לא החזיר מפת אתר תקינה — נסה שוב", 502);
        const fixPage = (p: any) => (String(p || "").toLowerCase() === "new" ? null : resolve(p));
        const hubs = (j.hubs || []).map((h: any, i: number) => ({
          id: String(h.id || `H${i + 1}`), name: unId(h.name), page_url: fixPage(h.page), new_title: h.new_title || "", clusters: h.clusters || [], why: unId(h.why || ""),
          children: (h.children || []).map((c: any) => ({ name: unId(c.name), page_url: fixPage(c.page), new_title: c.new_title || "", clusters: c.clusters || [], why: unId(c.why || "") })),
          alternatives: (h.alternatives || []).map((a: any) => ({ option: unId(a.option), pros: unId(a.pros || ""), cons: unId(a.cons || ""), recommended: !!a.recommended })),
        }));
        const hierarchy = { hubs, notes: unId(j.notes || "") };
        await sb.from("structure_ai_analysis").update({ hierarchy, stage: "hierarchy" }).eq("client_id", client_id);
        return jsonResponse({ hierarchy });
      }

      if (stage === "recs") {
        const hubs: any[] = cur?.hierarchy?.hubs || [];
        const hubId = String(body.hub_id || "");
        const [baseId, partStr] = hubId.split(".");
        const part = partStr == null ? null : Number(partStr);
        const hub = hubs.find((h) => h.id === baseId);
        if (!hub && hubId !== "SITE") return errorResponse("עמוד אב לא נמצא", 400);
        const pageRef = (u: string | null, t: string) => (u ? idOf(u) : `עמוד חדש "${t}"`);
        let scope: string;
        if (hub) {
          const cl = (ids: string[]) => clusters.filter((c) => ids.includes(c.id));
          const kids = part == null ? hub.children : hub.children.slice(part * CHILDREN_PER_PART, (part + 1) * CHILDREN_PER_PART);
          const withHub = part == null || part === 0;
          scope =
            `עמוד אב: "${hub.name}" → ${pageRef(hub.page_url, hub.new_title)}. למה: ${hub.why}\n` +
            (withHub ? `קבוצות של עמוד האב:\n${cl(hub.clusters).map(clusterText).join("\n")}\n`
              : `(חלק ${part! + 1} של עמוד האב: התמקד רק בעמודי הבן שלמטה ובקשר שלהם לעמוד האב. עמוד האב עצמו נותח בחלק אחר)\n`) +
            kids.map((c: any) => `עמוד בן: "${c.name}" → ${pageRef(c.page_url, c.new_title)}. למה: ${c.why}\n${cl(c.clusters).map(clusterText).join("\n")}`).join("\n") +
            (hub.alternatives?.length ? `\nחלופות שנשקלו: ${hub.alternatives.map((a: any) => `${a.recommended ? "[מומלץ] " : ""}${a.option} (+ ${a.pros} / − ${a.cons})`).join(" | ")}` : "");
        } else {
          scope = `המלצות ברמת האתר כולו, על בסיס מפת האתר:\n${hubs.map((h) => `- ${h.name} → ${pageRef(h.page_url, h.new_title)}; בנים: ${h.children.map((c: any) => `${c.name} → ${pageRef(c.page_url, c.new_title)}`).join(", ") || "—"}`).join("\n")}\nהערות מבנה: ${cur?.hierarchy?.notes || "—"}\n` +
            "התמקד במה שלא שייך לעמוד אב אחד: קישוריות פנימית בין עמודי האב והבנים, תפריט וניווט, עמודים חלשים/כפולים לאיחוד או להפניה, ועמודים שאינם במפה. עד 6 המלצות, המשמעותיות ביותר.";
        }
        const ask =
          "שלב 3 — המלצות. השווה את המבנה המומלץ למצב הקיים (איזה עמוד מדורג היום על כל מילה, החלטות יעד קיימות, תוכן העמודים) והמלץ מה לעשות בפועל. " +
          "כל מילה מופיעה בהמלצה אחת לכל היותר. אל תמליץ על מה שכבר מתקיים או שכבר אושר. היה תמציתי: עד 8 המלצות, ובכל שדה טקסט רק מה שחשוב להחלטה. " +
          "סוגים: same_intent (ריכוז מילים באותו עמוד), cannibalization (כמה עמודים מתחרים), relocate (מילה מדורגת שמתאימה יותר לעמוד אחר), unassigned (שיוך מילים בלי יעד), new_page (עמוד חדש), site_strategy (מבנה/קישוריות/איחוד).\n\n" +
          `${scope}\n\n` +
          'החזר JSON בלבד: {"recs":[{"type":"<אחד מהסוגים>","title":"<כותרת קצרה>","summary":"<משפט-שניים: מה עושים ולמה>",' +
          '"considerations":{"facts":["<עובדה מהנתונים עם מספרים: חשיפות, מיקום, איזה עמוד>"],"intent":"<מה כוונת המשתמש ולמה המילים שייכות יחד/לחוד>","options":[{"option":"<דרך פעולה>","pros":"<יתרונות>","cons":"<חסרונות>","chosen":true}],"risks":"<סיכונים ואיך לצמצם אותם>","why":"<למה בחרנו בדרך הזו>"},' +
          '"keywords":["<מילים מדויקות>"],"pages":["<מזהי עמודים>"],"actions":[{"keyword":"<מילה>","target":"<מזהה עמוד היעד או new>"}],"extra_steps":"<צעדים נוספים כרשימה במרקדאון>","new_page_title":"<אם יש עמוד חדש>","priority":"high|medium|low"}]}. ' +
          "בטקסט החופשי כתוב נתיבי עמודים (לא מזהים), השתמש ב-**הדגשה** ובשורות נפרדות כשיש כמה נקודות.";
        const resp = await callWithRetry(ask, 7000);
        const stamp = Date.now().toString(36);
        const recs = parseObj(textOf(resp), "recs").map((r: any, i: number) => normalizeRec(r, `${hubId}-${stamp}-${i}`, hub ? hub.name : "ברמת האתר"))
          .filter((r: any) => r.keywords.length > 0 || r.type === "site_strategy");
        return jsonResponse({ recs, stop: resp.stop_reason });
      }
      return errorResponse("stage לא מוכר", 400);
    }

    const messages: Message[] = convo.slice(-16).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") }));
    let reply = "";
    for (let iter = 0; iter < 6; iter++) {
      const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 4000, system, tools: [...TOOLS, ...CHAT_TOOLS], messages });
      messages.push({ role: "assistant", content: resp.content });
      if (resp.stop_reason !== "tool_use") {
        reply = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
        break;
      }
      const results: any[] = [];
      for (const b of resp.content) {
        if (b.type !== "tool_use") continue;
        results.push({ type: "tool_result", tool_use_id: (b as any).id, content: JSON.stringify(await runTool((b as any).name, (b as any).input || {})) });
      }
      messages.push({ role: "user", content: results });
    }
    reply = unId(reply);
    return jsonResponse({ reply: reply || "לא הצלחתי להגיע לתשובה מלאה — נסה לנסח את השאלה אחרת.", proposed, stats: { keywords: kws.length, pages: pageUrl.size } });
  } catch (e) {
    console.error(e);
    return errorResponse((e as Error).message, 500);
  }
});
