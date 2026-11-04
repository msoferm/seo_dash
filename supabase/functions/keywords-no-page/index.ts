/**
 * Tab "מילים ללא עמוד" (keywords without a dedicated page).
 * POST { client_id, action }:
 *   action "data"  → aggregate every keyword from the client's uploaded GSC/ZEFO reports
 *                    (uploaded_rows, ALL files, no date filter), dedupe across files while
 *                    keeping each source, and run the dedicated-page match heuristic against
 *                    the crawled `pages` (title/meta/H1). Returns rows + a summary.
 *   action "analyze" { rows } → Claude recommendations over the provided (filtered) subset.
 *
 * Match rules (per spec): a page merely RANKING for a phrase is not a DEDICATED page. We weigh
 * the phrase's significant tokens against each page's title + H1 (meta is a bonus only — a term
 * missing from meta alone never rules a page out). We do NOT demand an exact literal match, and
 * when the evidence is thin we return "needs_check" rather than auto-deciding there is no page.
 * rev: 2026-11-04a
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireTeamMember } from "../_shared/supabase.ts";
import { callClaude, DEFAULT_MODEL, textOf, extractJson } from "../_shared/anthropic.ts";

const HE_STOP = new Set([
  "של", "עם", "על", "את", "או", "גם", "אם", "כי", "זה", "זו", "יש", "לא", "כל", "הוא", "היא",
  "אני", "אנחנו", "הם", "הן", "מה", "מי", "איך", "כמה", "אל", "עד", "בין", "לפי", "אבל", "רק",
  "and", "or", "the", "a", "an", "of", "for", "to", "in", "on", "with",
]);
const HE_PREFIXES = "בהלומכש"; // single attached prefix letters

function stripNiqqud(s: string): string {
  return s.replace(/[֑-ׇ]/g, "");
}
function normText(s: string): string {
  return stripNiqqud(String(s || "")).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
/** Significant tokens: drop stopwords and 1-char tokens; add a prefix-stripped variant for Hebrew. */
function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normText(s).split(" ")) {
    if (!raw || raw.length < 2 || HE_STOP.has(raw)) continue;
    out.add(raw);
    if (raw.length > 3 && HE_PREFIXES.includes(raw[0])) out.add(raw.slice(1));
  }
  return out;
}
const normUrl = (u: string) => String(u || "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
function decodePath(u: string): string {
  try { return decodeURIComponent(String(u).replace(/^https?:\/\/[^/]+/, "")) || u; } catch { return u; }
}
/** Fraction of the keyword's significant tokens that appear in the page token set. */
function coverage(kwToks: Set<string>, pageToks: Set<string>): number {
  if (kwToks.size === 0) return 0;
  let hit = 0;
  for (const t of kwToks) if (pageToks.has(t)) hit++;
  return hit / kwToks.size;
}

type SrcKind = "gsc" | "zefo" | "other";
function sourceKind(src: string | null): SrcKind {
  const s = (src || "").toLowerCase();
  if (s.includes("search console") || s.includes("gsc")) return "gsc";
  if (s.includes("zefo")) return "zefo";
  return "other";
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { sb } = await requireTeamMember(req);
    const { client_id, action, rows: inRows } = await req.json();
    if (!client_id) return errorResponse("חסר client_id", 400);

    if (action === "analyze") return await analyze(inRows || []);
    return await buildData(sb, client_id);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});

async function buildData(sb: any, clientId: number) {
  // --- Load every uploaded row (all files, no date filter) with its dataset's source. ---
  const { data: datasets, error: dErr } = await sb
    .from("uploaded_datasets")
    .select("id, source, filename, date_from, date_to")
    .eq("client_id", clientId);
  if (dErr) throw new Error(dErr.message);
  const dsById = new Map<number, any>((datasets || []).map((d: any) => [d.id, d]));

  // Pull rows in pages (RLS-scoped). Keyword lives in `keyword` or `query`.
  const allRows: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("uploaded_rows")
      .select("dataset_id, page, query, keyword, impressions, clicks, position")
      .eq("client_id", clientId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    allRows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }

  // --- Load crawled pages for the match check (title/meta/H1). ---
  const { data: pagesData, error: pErr } = await sb
    .from("pages")
    .select("url, title, meta_description, h1, last_full_crawl")
    .eq("client_id", clientId);
  if (pErr) throw new Error(pErr.message);
  const pages = (pagesData || []).map((p: any) => ({
    url: p.url,
    title: p.title || "",
    meta: p.meta_description || "",
    h1: p.h1 || "",
    strongToks: tokens(`${p.title || ""} ${p.h1 || ""}`),
    allToks: tokens(`${p.title || ""} ${p.h1 || ""} ${p.meta_description || ""}`),
  }));
  const pagesDataAvailable = pages.some((p: any) => p.title || p.h1);
  const titleByUrl = new Map<string, string>();
  for (const p of pages) if (p.title) titleByUrl.set(normUrl(p.url), p.title);

  // --- Load the manual "נכתב" marks. ---
  const { data: written, error: wErr } = await sb
    .from("kw_written").select("keyword, written_url").eq("client_id", clientId);
  if (wErr) throw new Error(wErr.message);
  const writtenMap = new Map<string, string | null>((written || []).map((w: any) => [w.keyword, w.written_url ?? null]));

  // --- Group rows by keyword (deduped), keeping per-source page/position data. ---
  type PageHit = { url: string; position: number | null; kind: SrcKind; source: string };
  type Agg = {
    keyword: string;
    display: string;
    imprBySource: Map<SrcKind, number>;   // MAX per source (never summed across overlapping files)
    sources: Set<string>;
    pageHits: Map<string, PageHit>;        // key: `${kind}|${normUrl}`
    hadKeywordRows: boolean;
    hadPagelessRows: boolean;              // keyword rows that carried no page mapping
  };
  const byKw = new Map<string, Agg>();
  let fileKeywordRows = 0;

  for (const r of allRows) {
    const term = (r.keyword || r.query || "").trim();
    if (!term) continue;
    fileKeywordRows++;
    const key = normText(term);
    if (!key) continue;
    const ds = dsById.get(r.dataset_id);
    const srcName = ds?.source || "לא ידוע";
    const kind = sourceKind(srcName);
    let a = byKw.get(key);
    if (!a) {
      a = { keyword: key, display: term, imprBySource: new Map(), sources: new Set(), pageHits: new Map(), hadKeywordRows: true, hadPagelessRows: false };
      byKw.set(key, a);
    }
    a.sources.add(srcName);
    const impr = r.impressions == null ? null : Number(r.impressions);
    if (impr != null && !isNaN(impr)) {
      // MAX per source avoids double-counting across overlapping exports of the same source.
      a.imprBySource.set(kind, Math.max(a.imprBySource.get(kind) ?? 0, impr));
    }
    const page = (r.page || "").trim();
    if (page) {
      const nk = `${kind}|${normUrl(page)}`;
      const pos = r.position == null ? null : Number(r.position);
      const existing = a.pageHits.get(nk);
      // keep the best (lowest) position seen for this page+source
      if (!existing || (pos != null && (existing.position == null || pos < existing.position))) {
        a.pageHits.set(nk, { url: page, position: pos, kind, source: srcName });
      }
    } else {
      a.hadPagelessRows = true;
    }
  }

  // --- Assemble output rows with the match verdict. ---
  const out = [...byKw.values()].map((a) => {
    // Impressions figure: prefer GSC (the canonical impressions metric); else null = "אין נתון".
    const impressions = a.imprBySource.has("gsc") ? a.imprBySource.get("gsc")! : null;

    const kwToks = tokens(a.display);
    const rankingPages = [...a.pageHits.values()].map((h) => ({
      url: h.url,
      name: titleByUrl.get(normUrl(h.url)) || decodePath(h.url),
      position: h.position,
      source: h.source,
      metric: h.kind === "gsc" ? "מיקום ממוצע" : "מיקום",
    }));

    // Match heuristic
    let match: "no_page" | "to_improve" | "needs_check" = "no_page";
    let detail: any = null;
    if (!pagesDataAvailable) {
      match = "needs_check";
      detail = { reason: "חסרים נתוני עמודים (כותרת / H1 / תיאור מטא). הרץ סריקת אתר או ייבא דוח עמודים כדי לבדוק התאמה." };
    } else {
      let best: any = null, bestCov = 0;
      for (const p of pages) {
        const covStrong = coverage(kwToks, p.strongToks);
        const covAll = coverage(kwToks, p.allToks);
        const cov = Math.max(covStrong, covAll * 0.9); // title/H1 weigh more than meta
        if (cov > bestCov) { bestCov = cov; best = p; }
      }
      const rankBest = rankingPages.length ? rankingPages[0] : null;
      if (best && bestCov >= 0.99 && kwToks.size >= 1) {
        match = "to_improve";
        detail = { page: best.url, name: best.title || decodePath(best.url), title: best.title, meta: best.meta, h1: best.h1,
          reason: "נמצא עמוד שכותרת/‏H1 שלו תואמים נושאית לביטוי — מתאים לשיפור / התאמה כעמוד ייעודי." };
      } else if ((best && bestCov >= 0.6) || (rankBest && bestCov > 0)) {
        match = "needs_check";
        const p = best;
        detail = { page: p?.url || rankBest?.url, name: p?.title || (rankBest ? rankBest.name : ""), title: p?.title, meta: p?.meta, h1: p?.h1,
          reason: "יש עמוד בעל זיקה חלקית לביטוי (או עמוד שמופיע בתוצאות), אך ההתאמה אינה חד-משמעית — דורש בדיקה ידנית." };
      } else if (rankBest) {
        match = "needs_check";
        detail = { page: rankBest.url, name: rankBest.name,
          reason: "עמוד מופיע בתוצאות עבור הביטוי אך אין לו התאמה נושאית בכותרת/‏H1 — ייתכן שאין עמוד ייעודי. דורש בדיקה." };
      } else {
        match = "no_page";
        detail = { reason: "לא נמצא עמוד שכותרתו / H1 שלו עוסקים בביטוי זה." };
      }
    }

    return {
      keyword: a.display,
      key: a.keyword,
      impressions,                         // null → "אין נתון"
      impr_by_source: Object.fromEntries(a.imprBySource),
      sources: [...a.sources],
      pages: rankingPages,
      pages_missing: a.hadPagelessRows && rankingPages.length === 0, // report had no keyword→page mapping
      match,
      detail,
      written: writtenMap.has(a.keyword),
      written_url: writtenMap.get(a.keyword) ?? null,
    };
  });

  // Sort default: impressions desc (null last), then keyword.
  out.sort((x, y) => (y.impressions ?? -1) - (x.impressions ?? -1) || x.keyword.localeCompare(y.keyword, "he"));

  return jsonResponse({
    rows: out,
    summary: {
      files: (datasets || []).length,
      file_rows: fileKeywordRows,
      keywords: out.length,
      pages_data_available: pagesDataAvailable,
      sources: [...new Set((datasets || []).map((d: any) => d.source).filter(Boolean))],
    },
  });
}

async function analyze(rows: any[]) {
  if (!Array.isArray(rows) || rows.length === 0) return errorResponse("אין שורות לניתוח. סנן את הטבלה ונסה שוב.", 400);
  // Cap to keep the prompt bounded; the UI shows the count that will be analyzed.
  const capped = rows.slice(0, 180);
  const lines = capped.map((r: any) => {
    const impr = r.impressions == null ? "אין נתון" : r.impressions;
    const pgs = (r.pages || []).map((p: any) => `${p.name} (${p.metric} ${p.position ?? "—"}, ${p.source})`).join("; ") || "אין שיוך עמוד";
    const mt = r.match === "no_page" ? "לא נמצא עמוד ייעודי" : r.match === "to_improve" ? "עמוד לשיפור" : "דורש בדיקה";
    return `• "${r.keyword}" | חשיפות: ${impr} | עמודים מדורגים: ${pgs} | בדיקת התאמה: ${mt}`;
  }).join("\n");

  const system =
    "אתה אסטרטג SEO. קיבלת רשימת ביטויי חיפוש מדוחות Google Search Console ו-ZEFO, עם החשיפות, העמודים שמדורגים עליהם, " +
    "ותוצאת בדיקת התאמה ראשונית (האם קיים עמוד ייעודי). מטרתך: להמליץ מה לעשות עם כל ביטוי או קבוצת ביטויים. " +
    "קבץ ביטויים שעוסקים באותו נושא ומשרתים כוונת חיפוש דומה, ואל תמליץ על עמוד נפרד לכל וריאציה. " +
    "אל תמציא נפחי חיפוש או נתונים שלא סופקו. כשחסר מידע — ציין זאת מפורשות. " +
    'החזר אך ורק JSON בפורמט: {"recommendations":[{' +
    '"keywords":["ביטוי",...],' +            // הביטויים שההמלצה חלה עליהם (בדיוק כפי שהתקבלו)
    '"action":"new_page|improve_page|combine|needs_check",' +
    '"title":"כותרת קצרה להמלצה",' +
    '"explanation":"הסבר קצר",' +
    '"target_page":"עמוד מומלץ לשיפור או null",' +
    '"content_direction":"כיוון לתוכן/שינוי נדרש",' +
    '"priority":"high|medium|low",' +
    '"priority_reason":"נימוק לעדיפות",' +
    '"uncertainty":"מידע חסר/אי-ודאות או null"}]}. התחל ישירות ב-{.';

  const resp = await callClaude({
    model: DEFAULT_MODEL, max_tokens: 4000, system,
    messages: [{ role: "user", content: `הביטויים לניתוח (${capped.length}):\n${lines}` }],
  });
  let parsed: any;
  try { parsed = extractJson(textOf(resp)); } catch { return errorResponse("הניתוח לא הוחזר בפורמט תקין. נסה שוב.", 502); }
  return jsonResponse({ recommendations: parsed.recommendations || [], analyzed: capped.length });
}
