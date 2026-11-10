/**
 * "ביטויי יעד ועמודי יעד" AI consultant. POST { client_id, from, to, messages: [{role, content}] }
 * Loads a full snapshot of the client's site-structure data (GSC keyword→page map, target
 * decisions, secondary keywords, user-intent analyses, crawled page titles/H1, cannibalization)
 * into a cached system prompt, and lets Claude drill into the long tail with lookup tools.
 * Stateless: the frontend keeps the conversation and sends it with each call. Read-only.
 * rev: 2026-11-10a
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL, type Message, type ToolDefinition } from "../_shared/anthropic.ts";

const MAX_KW_IN_SNAPSHOT = 700;   // keywords listed in the system prompt (by impressions)
const MAX_PAGES_PER_KW = 5;

type Row = { page: string; term: string; clicks: number; impressions: number; ctr: number; position: number };
interface KwAgg { term: string; impressions: number; clicks: number; best: number; pages: Row[] }

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

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const body = await req.json();
    const { client_id, from, to } = body;
    const convo: { role: string; content: string }[] = Array.isArray(body.messages) ? body.messages : [];
    if (!client_id || !from || !to || convo.length === 0) return errorResponse("חסר client_id / טווח תאריכים / הודעה", 400);

    const { data: client } = await sb.from("clients").select("name, domain, notes").eq("id", client_id).maybeSingle();
    if (!client) return errorResponse("לקוח לא נמצא", 404);

    // ---- Load everything ----
    const rows: Row[] = [];
    for (let off = 0; off < 100000; off += 1000) {
      const { data, error } = await sb.rpc("gsc_page_query_map", { p_client_id: client_id, p_from: from, p_to: to }).range(off, off + 999);
      if (error) throw error;
      for (const r of data || []) rows.push({ page: r.page, term: r.term, clicks: +r.clicks || 0, impressions: +r.impressions || 0, ctr: +r.ctr || 0, position: +r.position || 0 });
      if (!data || data.length < 1000) break;
    }
    const [{ data: targets }, { data: secondary }, { data: intents }, { data: crawled }, { data: written }] = await Promise.all([
      sb.from("keyword_targets").select("keyword, page_url, intent, status, notes").eq("client_id", client_id),
      sb.from("page_keywords").select("page_url, keyword").eq("client_id", client_id),
      sb.from("page_intent").select("page_url, intent_analysis, conclusions, quality_score, saved_summary, primary_keywords, secondary_keywords").eq("client_id", client_id),
      sb.from("pages").select("url, title, h1, meta_description").eq("client_id", client_id).not("last_full_crawl", "is", null),
      sb.from("kw_written").select("keyword, written_url").eq("client_id", client_id),
    ]);

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
    const kws = [...byKw.values()].sort((a, b) => b.impressions - a.impressions);
    for (const k of kws) k.pages.sort((a, b) => b.impressions - a.impressions);
    // Register pages in order of total impressions so the busiest pages get the lowest ids.
    [...byPage.entries()].sort((a, b) => b[1].reduce((s, r) => s + r.impressions, 0) - a[1].reduce((s, r) => s + r.impressions, 0))
      .forEach(([, rs]) => idOf(rs[0].page));
    for (const t of targets || []) if (t.page_url) idOf(t.page_url);
    for (const s of secondary || []) idOf(s.page_url);
    for (const p of intents || []) idOf(p.page_url);

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
      return `${k.term} | ח${k.impressions} ק${k.clicks} | ${ps}${more}${targetLabel(k.term)}`;
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
    const writtenLines = (written || []).map((w: any) => `${w.keyword}${w.written_url ? ` → ${decodePath(w.written_url)}` : ""}`);

    const snapshot = [
      `=== עמודים (מזהה = נתיב | title | H1 | סה"כ חשיפות) — ${pageUrl.size} ===`, ...pageLines,
      `\n=== מילות מפתח מ-Search Console (${from} עד ${to}) — ${kws.length} סה"כ, מוצגות ${Math.min(kws.length, MAX_KW_IN_SNAPSHOT)} המובילות בחשיפות ===`,
      `פורמט: מילה | ח=חשיפות ק=קליקים | עמודים מדורגים: מזהה(מ=מיקום ממוצע, ח, ק) | החלטת יעד`,
      ...kws.slice(0, MAX_KW_IN_SNAPSHOT).map((k) => kwLine(k)),
      `\n=== קניבליזציה: מילים שיותר מעמוד אחד מדורג עליהן (${cannibal.length}) ===`,
      ...cannibal.map((k) => kwLine(k, 8)),
      `\n=== החלטות ביטוי יעד → עמוד יעד (לשונית "ביטויי יעד ועמודי יעד") — ${targetLines.length} ===`, ...(targetLines.length ? targetLines : ["אין עדיין"]),
      `\n=== ביטויי משנה לפי עמוד (לשונית "עמודי יעד וביטויי משנה") ===`, ...(secLines.length ? secLines : ["אין עדיין"]),
      `\n=== ניתוחי כוונת משתמש שנשמרו (לשונית "כוונת המשתמש") ===`, ...(intentLines.length ? intentLines : ["אין עדיין"]),
      `\n=== מילים שסומנו "נכתב" (לשונית "מילים ללא עמוד") ===`, ...(writtenLines.length ? writtenLines : ["אין"]),
    ].join("\n");

    const system = [
      {
        type: "text" as const,
        text:
          "אתה יועץ SEO בכיר בעברית המתמחה בארכיטקטורת אתר: שיוך מילות מפתח לעמודים, כוונת משתמש, קיבוץ מילים לעמוד אחד מול פיצול לעמודים נפרדים, ומניעת קניבליזציה. " +
          "לרשותך תמונת מצב מלאה של נתוני הלקוח (למטה). התבסס עליה ועל הכלים — אל תמציא מספרים, עמודים או מילים. " +
          "למילים שלא מופיעות בתמונת המצב השתמש ב-search_keywords; לפרטים מלאים על עמוד (כולל ניתוח כוונה מלא) השתמש ב-get_page.\n" +
          "כללים לשיוך מילים לעמוד: מילים עם אותה כוונת משתמש (אותו צורך, אותו שלב במסע, אותה תשובה מצופה) — באותו עמוד; כוונה שונה (מידע מול רכישה, מוצר שונה, קהל שונה) — עמודים נפרדים. " +
          "רמז חזק לכוונה זהה: גוגל כבר מדרג את אותו עמוד על שתי המילים. קניבליזציה: כמה עמודים של האתר מתחרים על אותה מילה ומפצלים חשיפות/מיקום. " +
          "כשאתה ממליץ — נמק (חשיפות, מיקום, איזה עמוד חזק יותר, כוונה), ציין עמודים בנתיב שלהם (לא במזהה P בלבד), והבחן בין עובדה מהנתונים לבין הערכה שלך. " +
          "ענה בעברית, ממוקד וברור, עם כותרות קצרות ורשימות כשזה עוזר. אתה רק מייעץ — אינך משנה דבר באתר או במערכת.\n\n" +
          `לקוח: ${client.name} (${client.domain}).${client.notes ? ` הערות על העסק: ${client.notes}` : ""}\n\n${snapshot}`,
        cache_control: { type: "ephemeral" as const },
      },
    ];

    const runTool = (name: string, input: any): unknown => {
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
          target_keywords: (targets || []).filter((t: any) => t.page_url && norm(t.page_url) === k).map((t: any) => t.keyword),
          secondary_keywords: secByUrl.get(k) || [],
          ranking_keywords: (byPage.get(k) || []).sort((a, b) => b.impressions - a.impressions).slice(0, 150)
            .map((r) => `${r.term} (מ${r.position}, ח${r.impressions}, ק${r.clicks}, ${(byKw.get(r.term)?.pages.length || 1) > 1 ? "מדורגים עליה עוד עמודים" : "רק עמוד זה"})`),
          user_intent: it ? { intent_analysis: it.intent_analysis, page_analysis_conclusions: it.conclusions, quality_score: it.quality_score, summary: it.saved_summary } : null,
        };
      }
      return { error: "כלי לא מוכר" };
    };

    const messages: Message[] = convo.slice(-16).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") }));
    let reply = "";
    for (let iter = 0; iter < 6; iter++) {
      const resp = await callClaude({ model: DEFAULT_MODEL, max_tokens: 3000, system, tools: TOOLS, messages });
      messages.push({ role: "assistant", content: resp.content });
      if (resp.stop_reason !== "tool_use") {
        reply = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
        break;
      }
      const results: any[] = [];
      for (const b of resp.content) {
        if (b.type !== "tool_use") continue;
        results.push({ type: "tool_result", tool_use_id: (b as any).id, content: JSON.stringify(runTool((b as any).name, (b as any).input || {})) });
      }
      messages.push({ role: "user", content: results });
    }
    return jsonResponse({ reply: reply || "לא הצלחתי להגיע לתשובה מלאה — נסה לנסח את השאלה אחרת.", stats: { keywords: kws.length, pages: pageUrl.size } });
  } catch (e) {
    console.error(e);
    return errorResponse((e as Error).message, 500);
  }
});
