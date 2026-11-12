import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, Search, ExternalLink, AlertTriangle, Check, X, Loader2, Save, Target, FileText, Sparkles, StickyNote, ChevronDown, ChevronUp, FolderCheck, Undo2, Layers3, Filter } from "lucide-react";
import { useFocusTarget } from "../components/useFocusTarget";
import * as api from "../api";
import type { KwPageRow, KeywordTarget } from "../api";
import PageHeader from "../components/PageHeader";
import DataSourceBanner from "../components/DataSourceBanner";
import Spinner from "../components/Spinner";
import StructureChat from "../components/StructureChat";
import StructureAiPlan, { type Selection } from "../components/StructureAiPlan";
import { decisionColor, SELECTED_COLOR } from "../lib/decisionColors";

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function decodePath(u: string): string {
  try { return decodeURIComponent(u.replace(/^https?:\/\/[^/]+/, "")) || u; } catch { return u; }
}
const norm = (u: string) => (u || "").replace(/\/+$/, "").toLowerCase();
/** How many of the keyword's words appear in the page URL/slug (textual match for #3). */
function matchScore(term: string, url: string): number {
  const toks = term.split(/\s+/).map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2);
  if (!toks.length) return 0;
  const p = decodePath(url).toLowerCase();
  return toks.filter((t) => p.includes(t)).length;
}
function isFullMatch(term: string, url: string): boolean {
  const toks = term.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2);
  return toks.length > 0 && matchScore(term, url) === toks.length;
}

// --- Similar-keyword filter: light Hebrew stemming so "זיווד לרכבים מסחריים" also finds
// "זיווד רכב מסחרי", "זיווד לרכב" etc. (prefix letter + plural/adjective suffixes stripped).
const SIM_STOP = new Set(["של", "עם", "על", "את", "או", "גם", "the", "and", "for"]);
function stem(t: string): string {
  let s = t;
  if (s.length > 3 && "והבלמשכ".includes(s[0])) s = s.slice(1);
  for (const suf of ["יים", "ים", "ות", "ית", "י", "ה"]) {
    if (s.length - suf.length >= 2 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  }
  return s;
}
function simTokens(s: string): string[] {
  return s.replace(/[֑-ׇ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((t) => t.length >= 2 && !SIM_STOP.has(t));
}
function tokMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const sa = stem(a), sb = stem(b);
  if (sa === sb) return true;
  return sa.length >= 3 && sb.length >= 3 && (sa.startsWith(sb) || sb.startsWith(sa));
}
/** Share of the query's words that appear (stemmed) in the term: 0..1. */
function similarity(query: string, term: string): number {
  const qt = simTokens(query); if (!qt.length) return 0;
  const tt = simTokens(term);
  return qt.filter((q) => tt.some((t) => tokMatch(q, t))).length / qt.length;
}

/** #4: a team note on a keyword ("needs a new page" / "needs content improvement" / free text).
 * Stored on keyword_targets.notes and synced into the work plan & content suggestions. */
function NoteEditor({ cid, term, saved, onSaved }: { cid: number; term: string; saved?: KeywordTarget; onSaved: () => void }) {
  const [note, setNote] = useState(saved?.notes || "");
  const [open, setOpen] = useState(false);
  const save = useMutation({
    mutationFn: (p: { notes: string; intent?: string }) =>
      api.upsertKeywordTarget(cid, { keyword: term, page_url: saved?.page_url ?? null, intent: p.intent ?? (saved?.intent || "strengthen"), notes: p.notes.trim() || null }),
    onSuccess: () => { onSaved(); setOpen(false); },
  });
  if (!open) {
    return (
      <button className="mt-2 text-xs text-slate-500 hover:text-brand-600 inline-flex items-center gap-1" onClick={() => setOpen(true)}>
        <StickyNote size={13} /> {saved?.notes ? "ערוך הערה למערכת" : "הוסף הערה למערכת"}
      </button>
    );
  }
  return (
    <div className="mt-2 bg-amber-50/60 border border-amber-200 rounded-lg p-2 space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-slate-500">הערה מהירה:</span>
        <button className="badge bg-white border border-amber-300 text-amber-700 hover:bg-amber-100" onClick={() => save.mutate({ notes: note.trim() || "דורש כתיבת דף חדש", intent: "new_page" })}>דורש כתיבת דף חדש</button>
        <button className="badge bg-white border border-amber-300 text-amber-700 hover:bg-amber-100" onClick={() => save.mutate({ notes: note.trim() || "דורש שיפור תוכן לעמוד", intent: "strengthen" })}>דורש שיפור תוכן</button>
      </div>
      <textarea className="input py-1 text-sm w-full" rows={2} placeholder="הערה חופשית למערכת (תיכנס לתכנית העבודה ולהצעות שיפור התוכן)..." value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex items-center gap-1.5">
        <button className="btn-primary text-xs py-1 px-2" onClick={() => save.mutate({ notes: note })} disabled={save.isPending}>
          {save.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} שמור הערה
        </button>
        <button className="text-xs py-1 px-2 rounded text-slate-500 hover:bg-white" onClick={() => setOpen(false)}>סגור</button>
        {save.isError && <span className="text-xs text-rose-600">{(save.error as any)?.message}</span>}
      </div>
    </div>
  );
}

/** #3: per-keyword target editor — choose the page that should own this keyword (or a new page).
 * New (just-written) pages appear as purple "🆕" options until chosen. */
function TargetEditor({ cid, term, candidates, newUrls, saved, onSaved }: { cid: number; term: string; candidates: string[]; newUrls: Set<string>; saved?: KeywordTarget; onSaved: () => void }) {
  const NEW = "__new__";
  const initSel = saved ? (saved.intent === "new_page" ? NEW : (saved.page_url || candidates[0] || NEW)) : (candidates[0] || NEW);
  const [sel, setSel] = useState<string>(initSel);
  const [newUrl, setNewUrl] = useState<string>(saved?.intent === "new_page" ? (saved.page_url || "") : "");
  const save = useMutation({
    mutationFn: () => {
      if (sel === NEW) return api.upsertKeywordTarget(cid, { keyword: term, page_url: newUrl.trim() || null, intent: "new_page", notes: saved?.notes ?? null });
      return api.upsertKeywordTarget(cid, { keyword: term, page_url: sel, intent: "strengthen", notes: saved?.notes ?? null });
    },
    onSuccess: onSaved,
  });
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 bg-slate-50 rounded-lg p-2">
      <Target size={14} className="text-brand-600 shrink-0" />
      <span className="text-xs text-slate-500">עמוד יעד:</span>
      <select className="input py-1 text-xs w-auto max-w-[280px]" value={sel} onChange={(e) => setSel(e.target.value)}>
        {candidates.map((p) => <option key={p} value={p}>{newUrls.has(norm(p)) ? "🆕 " : ""}{decodePath(p)}</option>)}
        <option value={NEW}>➕ עמוד חדש (לכתוב מאמר)</option>
      </select>
      {sel === NEW && (
        <input className="input py-1 text-xs w-56" placeholder="כתובת עמוד חדש (אופציונלי)" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
      )}
      <button className="btn-primary text-xs py-1 px-2" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} שמור יעד
      </button>
      {save.isSuccess && <span className="text-xs text-emerald-600">נשמר ✓</span>}
      {save.isError && <span className="text-xs text-rose-600">{(save.error as any)?.message}</span>}
    </div>
  );
}

export default function StructureKeywordsPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();

  const today = new Date();
  const [from, setFrom] = useState(fmt(new Date(today.getTime() - 90 * 86400000)));
  const [to, setTo] = useState(fmt(today));
  const [q, setQ] = useState("");
  const [onlyCannibal, setOnlyCannibal] = useState(false);
  const [definedOpen, setDefinedOpen] = useState(false); // #1b: the "defined pages" folder
  const [posMax, setPosMax] = useState("");   // #3a: show only rows ranked at/above this position
  const [imprMin, setImprMin] = useState("");  // #3a: show only rows with at least this many impressions
  const [simQ, setSimQ] = useState("");        // general filter: keywords similar to this text
  const [urlFilter, setUrlFilter] = useState(""); // general filter: keywords that share this ranking URL (normalized)
  const [filterMode, setFilterMode] = useState<"kw" | "url" | "both">("kw");
  const [flash, setFlash] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: rows, isLoading, refetch, isFetching } = useQuery({ queryKey: ["kw-map", cid, from, to], queryFn: () => api.getKeywordPageMap(cid, from, to), enabled: !!cid });
  const { data: targets } = useQuery({ queryKey: ["kw-targets", cid], queryFn: () => api.listKeywordTargets(cid), enabled: !!cid });
  const { data: posts } = useQuery({ queryKey: ["blog-posts", cid], queryFn: () => api.listBlogPosts(cid), enabled: !!cid });
  const invalidateTargets = () => qc.invalidateQueries({ queryKey: ["kw-targets", cid] });
  const delTarget = useMutation({ mutationFn: (id: number) => api.deleteKeywordTarget(id), onSuccess: invalidateTargets });
  // Combined AI analysis: accepted decisions color their keywords; the reviewed one is highlighted.
  const { data: decisions } = useQuery({ queryKey: ["structure-decisions", cid], queryFn: () => api.listStructureDecisions(cid), enabled: !!cid });
  const [selection, setSelection] = useState<Selection>(null);
  const [decKwOpen, setDecKwOpen] = useState<Record<string, boolean>>({}); // decided keywords start collapsed
  const decisionByKw = useMemo(() => {
    const m = new Map<string, NonNullable<typeof decisions>[number]>();
    for (const d of decisions || []) for (const k of d.keywords) m.set(k, d); // oldest first → latest wins
    return m;
  }, [decisions]);
  const selectedKws = useMemo(() => new Set(selection?.keywords || []), [selection]);

  const targetByTerm = useMemo(() => {
    const m = new Map<string, KeywordTarget>();
    for (const t of targets || []) m.set(t.keyword, t);
    return m;
  }, [targets]);

  // URLs already chosen as some keyword's target page (so they're no longer "new/unassigned").
  const assignedUrls = useMemo(() => {
    const s = new Set<string>();
    for (const t of targets || []) if (t.page_url) s.add(norm(t.page_url));
    return s;
  }, [targets]);

  // #5: pages the system has written (published/draft blog articles with a URL), by their keyword.
  const writtenByTerm = useMemo(() => {
    const m = new Map<string, { url: string; title: string; created_at: string }[]>();
    for (const p of posts || []) {
      if (!p.url || !["publish", "draft", "done"].includes(p.status || "")) continue;
      const k = (p.keyword || "").trim();
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push({ url: p.url, title: p.title, created_at: p.created_at });
    }
    return m;
  }, [posts]);
  const writtenUrls = useMemo(() => {
    const s = new Set<string>();
    for (const arr of writtenByTerm.values()) for (const w of arr) s.add(norm(w.url));
    return s;
  }, [writtenByTerm]);
  // #6: written pages not yet assigned as any target — they need to be defined as a target page.
  const newPages = useMemo(() => {
    const seen = new Set<string>(); const out: { url: string; title: string; keyword: string }[] = [];
    for (const p of posts || []) {
      if (!p.url || !["publish", "draft", "done"].includes(p.status || "")) continue;
      const nu = norm(p.url);
      if (seen.has(nu) || assignedUrls.has(nu)) continue;
      seen.add(nu); out.push({ url: p.url, title: p.title, keyword: (p.keyword || "").trim() });
    }
    return out;
  }, [posts, assignedUrls]);

  // #3a: filter the GSC rows by position (≤) and impressions (≥) before grouping.
  const byTerm = useMemo(() => {
    const pMax = posMax.trim() ? Number(posMax) : null;
    const iMin = imprMin.trim() ? Number(imprMin) : null;
    const bt = new Map<string, KwPageRow[]>();
    for (const r of rows || []) {
      if (pMax != null && !(r.position <= pMax)) continue;
      if (iMin != null && !(r.impressions >= iMin)) continue;
      if (!bt.has(r.term)) bt.set(r.term, []);
      bt.get(r.term)!.push(r);
    }
    for (const arr of bt.values()) arr.sort((a, b) => b.impressions - a.impressions);
    return bt;
  }, [rows, posMax, imprMin]);

  const fullByTerm = useMemo(() => {
    const bt = new Map<string, KwPageRow[]>();
    for (const r of rows || []) { if (!bt.has(r.term)) bt.set(r.term, []); bt.get(r.term)!.push(r); }
    for (const arr of bt.values()) arr.sort((a, b) => b.impressions - a.impressions);
    return bt;
  }, [rows]);

  // Keyword rows = union of GSC terms and keywords that have a written page (so new pages always show).
  const termEntries = useMemo(() => {
    const terms = new Set<string>([...byTerm.keys()]);
    for (const k of writtenByTerm.keys()) if (k) terms.add(k);
    let list = [...terms].map((term) => ({ term, pgs: byTerm.get(term) || [], written: writtenByTerm.get(term) || [] }));
    if (onlyCannibal) list = list.filter((e) => e.pgs.length >= 2);
    if (q.trim()) { const s = q.trim().toLowerCase(); list = list.filter((e) => e.term.toLowerCase().includes(s)); }
    const impr = (e: { pgs: KwPageRow[] }) => e.pgs.reduce((s, r) => s + r.impressions, 0);
    // Shared-URL filter: only keywords for which this URL also ranks in Google.
    if (filterMode !== "kw" && urlFilter) list = list.filter((e) => e.pgs.some((r) => norm(r.page) === urlFilter));
    if (filterMode !== "url" && simQ.trim()) {
      const scored = list.map((e) => ({ e, sc: similarity(simQ, e.term) })).filter((x) => x.sc >= 0.5);
      return scored.sort((a, b) => b.sc - a.sc || impr(b.e) - impr(a.e)).map((x) => x.e);
    }
    return list.sort((a, b) => impr(b) - impr(a));
  }, [byTerm, writtenByTerm, onlyCannibal, q, simQ, urlFilter, filterMode]);

  // Ranking URLs for the shared-URL filter, most keywords first.
  const { data: crawled } = useQuery({ queryKey: ["crawled-pages", cid], queryFn: () => api.listCrawledPages(cid), enabled: !!cid });
  const urlOptions = useMemo(() => {
    const titles = new Map<string, string>();
    for (const c of crawled || []) if (c.title) titles.set(norm(c.url), c.title);
    const m = new Map<string, { url: string; count: number }>();
    for (const arr of byTerm.values()) for (const r of arr) {
      const k = norm(r.page); const cur = m.get(k);
      if (cur) cur.count++; else m.set(k, { url: r.page, count: 1 });
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, url: v.url, count: v.count, label: titles.get(k) || decodePath(v.url) }))
      .sort((a, b) => b.count - a.count);
  }, [byTerm, crawled]);
  const filterUrl = (url: string) => { setUrlFilter(norm(url)); setFilterMode(simQ.trim() ? "both" : "url"); };
  const kwActive = filterMode !== "url" && !!simQ.trim();
  const urlActive = filterMode !== "kw" && !!urlFilter;

  const cannibalCount = [...byTerm.values()].filter((p) => p.length >= 2).length;

  // #1b: a keyword counts as "defined" once it has a chosen target page (or an explicit new-page).
  const isDefined = (term: string) => { const s = targetByTerm.get(term); return !!(s && (s.page_url || s.intent === "new_page")); };
  const pendingEntries = termEntries.filter((e) => !isDefined(e.term));
  const definedEntries = termEntries.filter((e) => isDefined(e.term));
  const definedCount = (targets || []).filter((t) => t.page_url || t.intent === "new_page").length;

  // 1a: return a defined keyword to the pending list. Keeps a team note if there is one
  // (= the state before a page was chosen); otherwise removes the target row entirely.
  const undefine = useMutation({
    mutationFn: (t: KeywordTarget) => t.notes
      ? api.upsertKeywordTarget(cid, { keyword: t.keyword, page_url: null, intent: "strengthen", notes: t.notes })
      : api.deleteKeywordTarget(t.id),
    onSuccess: invalidateTargets,
  });

  // Deep link from the work plan (?focus=<keyword>): clear filters + open the defined folder.
  useFocusTarget(!isLoading && targets !== undefined, () => {
    setQ(""); setSimQ(""); setUrlFilter(""); setOnlyCannibal(false); setPosMax(""); setImprMin(""); setDefinedOpen(true);
  });

  const jumpTo = (term: string) => {
    setQ(""); setOnlyCannibal(false); setDefinedOpen(true);
    setTimeout(() => {
      const el = rowRefs.current[term];
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); setFlash(term); setTimeout(() => setFlash(null), 2200); }
    }, 70);
  };

  const renderCard = ({ term, pgs, written }: { term: string; pgs: KwPageRow[]; written: { url: string; title: string; created_at: string }[] }, copy = false) => {
    // Accepted AI decision on this keyword: its own color, collapsed by default, details always shown.
    const dec = decisionByKw.get(term);
    const dc = dec ? decisionColor(dec.color) : null;
    const sel = selectedKws.has(term);
    const kwOpen = copy || !dec || !!decKwOpen[term];
    const boxStyle: React.CSSProperties = {
      ...(dc ? { background: dc.bg, borderColor: dc.border, borderRightWidth: 5 } : {}),
      ...(sel && !copy ? { outline: `3px solid ${SELECTED_COLOR.border}`, outlineOffset: 1, ...(dc ? {} : { background: SELECTED_COLOR.bg, borderColor: SELECTED_COLOR.border, borderRightWidth: 5 }) } : {}),
    };
    const act = dec?.actions.find((a) => a.keyword === term);
    const decHeader = dec && dc ? (
      <div className="mb-2 text-xs space-y-0.5" style={{ color: dc.text }}>
        <div className="flex items-center gap-1.5 flex-wrap">
          {!copy && (
            <button className="inline-flex items-center gap-1 font-medium text-sm" onClick={() => setDecKwOpen((o) => ({ ...o, [term]: !kwOpen }))} title={kwOpen ? "סגור" : "פתח"}>
              {kwOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />} {!kwOpen && <span className="text-slate-900">{term}</span>}
            </button>
          )}
          <span className="badge bg-white/80 border" style={{ borderColor: dc.border, color: dc.text }}>החלטה: {dec.title}</span>
          {act && <span>← {act.page_url ? decodePath(act.page_url) : "עמוד חדש"}</span>}
        </div>
        {dec.explanation && <div className={kwOpen ? "" : "line-clamp-2"}><b>למה:</b> {dec.explanation}</div>}
        {dec.note && <div><b>הערת צוות:</b> {dec.note}</div>}
      </div>
    ) : null;
    if (!kwOpen) {
      return (
        <div key={term} data-focus={term} ref={(el) => { rowRefs.current[term] = el; }} className="border rounded-lg p-3" style={boxStyle}>{decHeader}</div>
      );
    }
    const total = pgs.reduce((s, r) => s + r.impressions, 0);
    const clicks = pgs.reduce((s, r) => s + r.clicks, 0);
    const avgPos = total > 0 ? (pgs.reduce((s, r) => s + r.position * r.impressions, 0) / total) : (pgs.length ? pgs.reduce((s, r) => s + r.position, 0) / pgs.length : 0);
    const cannibal = pgs.length >= 2;
    const saved = targetByTerm.get(term);
    const gscUrls = new Set(pgs.map((r) => norm(r.page)));
    type Item = { url: string; position: number | null; impressions: number | null; written: boolean; isNew: boolean };
    const items: Item[] = [
      ...pgs.map((r) => ({ url: r.page, position: r.position, impressions: r.impressions, written: writtenUrls.has(norm(r.page)), isNew: writtenUrls.has(norm(r.page)) && !assignedUrls.has(norm(r.page)) })),
      ...written.filter((w) => !gscUrls.has(norm(w.url))).map((w) => ({ url: w.url, position: null, impressions: null, written: true, isNew: !assignedUrls.has(norm(w.url)) })),
    ];
    items.sort((a, b) => (isFullMatch(term, b.url) ? 1 : 0) - (isFullMatch(term, a.url) ? 1 : 0) || matchScore(term, b.url) - matchScore(term, a.url) || (b.impressions || 0) - (a.impressions || 0));
    const candidates = items.map((i) => i.url);
    const newUrlSet = new Set(items.filter((i) => i.isNew).map((i) => norm(i.url)));
    const flashing = flash === term;
    return (
      <div key={term} data-focus={copy ? undefined : term} ref={copy ? undefined : (el) => { rowRefs.current[term] = el; }} style={flashing ? undefined : boxStyle} className={`border rounded-lg p-3 transition-colors ${flashing ? "border-brand-400 bg-brand-50/60 ring-2 ring-brand-200" : "border-slate-200"}`}>
        {decHeader}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="font-medium text-slate-900 flex items-center gap-2">
            {term}
            {cannibal && <span className="badge bg-rose-50 text-rose-600 inline-flex items-center gap-1"><AlertTriangle size={11} /> {pgs.length} עמודים</span>}
            {pgs.length === 0 && written.length > 0 && <span className="badge bg-violet-50 text-violet-600">נכתב עמוד חדש</span>}
          </div>
          <div className="text-xs text-slate-400">
            {pgs.length ? <>{total.toLocaleString()} חשיפות · {clicks.toLocaleString()} קליקים · מיקום ממוצע {avgPos.toFixed(1)}</> : "אין עדיין נתוני חיפוש"}
          </div>
        </div>
        {items.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100">
            {items.map((it) => {
              const full = isFullMatch(term, it.url);
              return (
                <li key={it.url} className={`py-1 flex items-center justify-between gap-2 text-sm ${it.isNew ? "bg-violet-50/60 -mx-1 px-1 rounded" : ""}`}>
                  <a href={it.url} target="_blank" rel="noreferrer" className={`hover:underline truncate inline-flex items-center gap-1 min-w-0 ${it.isNew ? "text-violet-700" : "text-brand-600"}`}>
                    {it.written ? <FileText size={11} className="shrink-0" /> : <ExternalLink size={11} className="shrink-0" />}
                    <span className="truncate">{decodePath(it.url)}</span>
                    {full && <span className="badge bg-emerald-50 text-emerald-700 shrink-0">התאמה מלאה</span>}
                    {it.isNew && <span className="badge bg-violet-100 text-violet-700 shrink-0">חדש — להגדיר כיעד</span>}
                  </a>
                  <span className="text-xs text-slate-400 shrink-0 inline-flex items-center gap-2">
                    {it.position != null ? <>מיקום {it.position} · {(it.impressions || 0).toLocaleString()} חשיפות</> : "טרם מדורג"}
                    {it.position != null && (
                      <button className={`hover:text-brand-600 inline-flex items-center gap-0.5 ${urlActive && urlFilter === norm(it.url) ? "text-brand-600" : ""}`} title="הצג את כל הביטויים שהעמוד הזה מדורג עליהם" onClick={() => filterUrl(it.url)}>
                        <Filter size={11} /> ביטויים משותפים
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {saved && (saved.page_url || saved.intent === "new_page") && (
          <div className="mt-2 text-xs inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 rounded px-2 py-1">
            <Check size={12} /> יעד מוגדר: {saved.intent === "new_page" ? `עמוד חדש${saved.page_url ? ` (${decodePath(saved.page_url)})` : ""}` : decodePath(saved.page_url || "")}
            <button className="text-emerald-600 hover:text-rose-600 mr-1" title="הסר יעד" onClick={() => delTarget.mutate(saved.id)}><X size={12} /></button>
          </div>
        )}
        {saved && isDefined(term) && (
          <button className="mt-2 mr-2 text-xs inline-flex items-center gap-1 text-slate-500 hover:text-brand-600 border border-slate-200 rounded px-2 py-1"
            title="בטל את הגדרת עמוד היעד והחזר את הביטוי לרשימה למעלה" onClick={() => undefine.mutate(saved)} disabled={undefine.isPending}>
            <Undo2 size={12} /> בטל והחזר לרשימה
          </button>
        )}
        {saved?.notes && (
          <div className="mt-2 text-xs inline-flex items-start gap-1 bg-amber-50 text-amber-800 rounded px-2 py-1"><StickyNote size={12} className="mt-0.5 shrink-0" /> {saved.notes}</div>
        )}
        <TargetEditor cid={cid} term={term} candidates={candidates} newUrls={newUrlSet} saved={saved} onSaved={invalidateTargets} />
        <NoteEditor cid={cid} term={term} saved={saved} onSaved={invalidateTargets} />
      </div>
    );
  };

  return (
    <div>
      <PageHeader title="ביטויי יעד ועמודי יעד" subtitle={client ? `${client.name} · הגדרת עמוד היעד לכל ביטוי` : "ביטויי יעד ועמודי יעד"} />
      <DataSourceBanner cid={cid} match={["Search Console"]} />

      {/* AI consultant: knows all keywords, pages, cannibalization, targets and user-intent analyses */}
      <StructureChat cid={cid} from={from} to={to} />

      {/* Combined AI analysis → recommendations → accepted decisions (colored in the table below) */}
      <StructureAiPlan cid={cid} from={from} to={to} decisions={decisions || []} selection={selection} onSelect={setSelection}
        pageOptions={urlOptions.map((o) => ({ url: o.url, label: o.label }))}
        kwLines={(kws) => kws.map((k) => { const ps = fullByTerm.get(k) || []; return `${k} | ${ps.reduce((n, r) => n + r.impressions, 0)} חשיפות | ${ps.slice(0, 5).map((r) => `${decodePath(r.page)} (מ' ${r.position}, ${r.impressions})`).join("; ") || "אין דירוג"}`; })}
        renderCards={(kws) => kws.map((k) => renderCard({ term: k, pgs: fullByTerm.get(k) || [], written: writtenByTerm.get(k) || [] }, true))} />

      {/* #6: new written pages that still need a target-page decision */}
      {newPages.length > 0 && (
        <div className="card mb-4 border-r-4 border-r-violet-400 bg-violet-50/40">
          <h3 className="font-semibold flex items-center gap-2 text-violet-800 mb-2"><Sparkles size={17} /> עמודים חדשים שנכתבו — להגדיר כעמוד יעד ({newPages.length})</h3>
          <ul className="space-y-1.5">
            {newPages.map((np) => (
              <li key={np.url} className="flex items-center justify-between gap-2 text-sm bg-white border border-violet-200 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium text-slate-800 truncate">{np.title}</div>
                  <a href={np.url} target="_blank" rel="noreferrer" className="text-xs text-violet-600 hover:underline inline-flex items-center gap-1 min-w-0"><ExternalLink size={11} className="shrink-0" /><span className="truncate">{decodePath(np.url)}</span></a>
                </div>
                {np.keyword
                  ? <button className="btn-secondary text-xs py-1 px-2 shrink-0 border-violet-300 text-violet-700" onClick={() => jumpTo(np.keyword)}><Target size={12} /> הגדר ל"{np.keyword}"</button>
                  : <span className="text-xs text-slate-400 shrink-0">ללא ביטוי משויך</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card mb-4">
        <p className="text-sm text-slate-600 mb-3">
          הגדר לכל ביטוי את <b>עמוד היעד</b>, והוסף <b>הערה למערכת</b> — והלשוניות האחרות (תכנית עבודה, הצעות שיפור תוכן) יסתנכרנו אליו.
          ברגע שהגדרת עמוד יעד לביטוי, הוא עובר לתיקיית <b>"הוגדר עמוד"</b> למטה, וכאן נשארים רק הביטויים שעוד ממתינים להגדרה.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">מתאריך</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">עד תאריך</label>
            <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} רענן נתונים
          </button>
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : (rows || []).length === 0 && newPages.length === 0 ? (
        <div className="card text-center py-10 text-slate-500 text-sm">
          <Network size={36} className="mx-auto mb-2 text-slate-300" />
          אין נתוני Search Console בטווח שנבחר. ודא שהלקוח מחובר ל-GSC וסונכרן, או הרחב את טווח התאריכים.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Tile label="סה״כ ביטויים" value={byTerm.size} />
            <Tile label="הוגדר עמוד יעד" value={definedCount} />
            <Tile label="ממתינים להגדרה" value={Math.max(0, byTerm.size - definedCount)} />
            <Tile label="ביטויים בקניבליזציה" value={cannibalCount} alert={cannibalCount > 0} />
          </div>

          {/* General filter: similar keywords / shared ranking URL / both (applies to both lists) */}
          <div className="card mb-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Layers3 size={16} className="text-brand-600 shrink-0" />
              <span className="text-sm font-medium text-slate-700">סינון כללי:</span>
              {([["kw", "לפי מילת מפתח"], ["url", "לפי עמוד משותף"], ["both", "מילת מפתח + עמוד משותף"]] as const).map(([k, label]) => (
                <button key={k} className={`text-xs py-1 px-2.5 rounded-full border ${filterMode === k ? "bg-brand-600 text-white border-brand-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`} onClick={() => setFilterMode(k)}>{label}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {filterMode !== "url" && (
                <input className="input py-1 text-sm flex-1 min-w-[220px]" placeholder='ביטויים דומים ל… (למשל: זיווד לרכבים מסחריים)' value={simQ} onChange={(e) => setSimQ(e.target.value)} />
              )}
              {filterMode !== "kw" && (
                <select className="input py-1 text-sm flex-1 min-w-[220px] max-w-full" value={urlFilter} onChange={(e) => setUrlFilter(e.target.value)} title="הצג רק ביטויים שהעמוד הזה מדורג גם עליהם">
                  <option value="">בחר עמוד מדורג משותף…</option>
                  {urlOptions.map((o) => <option key={o.key} value={o.key}>{o.label} ({o.count} ביטויים)</option>)}
                </select>
              )}
            </div>
            {(kwActive || urlActive) && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{termEntries.length} ביטויים ({pendingEntries.length} ממתינים · {definedEntries.length} הוגדרו)</span>
                {urlActive && <a href={urlOptions.find((o) => o.key === urlFilter)?.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-0.5"><ExternalLink size={11} /> פתח את העמוד</a>}
                <button className="text-slate-400 hover:text-rose-600" onClick={() => { setSimQ(""); setUrlFilter(""); }}>נקה</button>
              </div>
            )}
          </div>

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="font-semibold text-slate-800 text-sm">ביטויים שממתינים להגדרת עמוד יעד</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs text-slate-500 inline-flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={onlyCannibal} onChange={(e) => setOnlyCannibal(e.target.checked)} /> רק קניבליזציה
                </label>
                <label className="text-xs text-slate-500 inline-flex items-center gap-1" title="הצג רק תוצאות במיקום הזה או טוב ממנו">
                  מיקום עד
                  <input type="number" min={1} className="input py-1 text-sm w-16" placeholder="∞" value={posMax} onChange={(e) => setPosMax(e.target.value)} />
                </label>
                <label className="text-xs text-slate-500 inline-flex items-center gap-1" title="הצג רק תוצאות עם לפחות כך וכך חשיפות">
                  חשיפות מ-
                  <input type="number" min={0} className="input py-1 text-sm w-20" placeholder="0" value={imprMin} onChange={(e) => setImprMin(e.target.value)} />
                </label>
                {(posMax || imprMin) && <button className="text-xs text-slate-400 hover:text-rose-600" onClick={() => { setPosMax(""); setImprMin(""); }}>נקה</button>}
                <div className="relative">
                  <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="input py-1 text-sm pr-7 w-52" placeholder="חפש ביטוי" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {pendingEntries.map((e) => renderCard(e))}
              {pendingEntries.length === 0 && <p className="text-slate-400 text-sm">אין ביטויים שממתינים להגדרה. {definedEntries.length > 0 ? 'כל הביטויים הוגדרו — ראה תיקיית "הוגדר עמוד".' : ""}</p>}
            </div>
          </div>

          {/* #1b: "defined" folder — keywords that already have a target page move here */}
          {definedEntries.length > 0 && (
            <div className="card mt-4">
              <button className="w-full flex items-center justify-between gap-2 text-right" onClick={() => setDefinedOpen((o) => !o)}>
                <h3 className="font-semibold flex items-center gap-2 text-slate-800"><FolderCheck size={18} className="text-emerald-600" /> הוגדר עמוד <span className="text-xs font-normal text-slate-400">({definedEntries.length})</span></h3>
                {definedOpen ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
              </button>
              {(definedOpen || kwActive || urlActive || !!selection) &&<div className="space-y-3 mt-3">{definedEntries.map((e) => renderCard(e))}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={`card py-3 text-center ${alert ? "border-rose-200 bg-rose-50/40" : ""}`}>
      <div className={`text-2xl font-bold ${alert ? "text-rose-600" : "text-slate-900"}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
