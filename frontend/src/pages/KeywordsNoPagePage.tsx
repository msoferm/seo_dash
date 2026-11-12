import { useMemo, useRef, useState, useEffect, Fragment } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileSearch, Upload, FolderUp, Loader2, Search, Check, X, ChevronDown, ChevronUp,
  ExternalLink, Sparkles, Link2, Layers3, AlertTriangle, CheckCircle2, HelpCircle, Pencil,
} from "lucide-react";
import * as api from "../api";
import type { KwNoPageRow, KwNoPageRec, KwMatch } from "../api";
import { expandFile, isSupported } from "../lib/fileImport";
import UploadSummary, { type UploadResultRow } from "../components/UploadSummary";
import PageHeader from "../components/PageHeader";
import DataSourceBanner from "../components/DataSourceBanner";
import Spinner from "../components/Spinner";

// --- light client-side tokenizer (mirrors the server) for the "similar phrases" grouping ---
const HE_STOP = new Set(["של", "עם", "על", "את", "או", "גם", "אם", "כי", "זה", "זו", "יש", "לא", "כל", "הוא", "היא", "מה", "מי", "איך", "כמה", "and", "or", "the", "for", "to", "in", "on", "with"]);
function toks(s: string): string[] {
  return (s || "").normalize("NFKD").replace(/[֑-ׇ]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
    .filter((t) => t.length >= 2 && !HE_STOP.has(t));
}
function sig(s: string): string { return toks(s).sort().slice(0, 3).join("|"); }

type DoneFilter = "all" | "written" | "unwritten";
type MatchFilter = "all" | KwMatch;
type SortField = "impressions" | "keyword" | "status";

const MATCH_META: Record<KwMatch, { label: string; cls: string; Icon: any }> = {
  no_page: { label: "לא נמצא עמוד ייעודי", cls: "bg-rose-50 text-rose-700 border-rose-200", Icon: AlertTriangle },
  to_improve: { label: "נמצא עמוד שעשוי להתאים לשיפור", cls: "bg-amber-50 text-amber-700 border-amber-200", Icon: CheckCircle2 },
  needs_check: { label: "דורש בדיקה", cls: "bg-slate-100 text-slate-600 border-slate-200", Icon: HelpCircle },
};
const ACTION_LABEL: Record<KwNoPageRec["action"], string> = {
  new_page: "יצירת עמוד חדש", improve_page: "שיפור עמוד קיים", combine: "שילוב ביטויים בעמוד אחד", needs_check: "בדיקה נוספת",
};
const PRIORITY_CLS: Record<string, string> = { high: "bg-rose-100 text-rose-700", medium: "bg-amber-100 text-amber-700", low: "bg-slate-100 text-slate-600" };

export default function KeywordsNoPagePage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement | null>>(new Map());

  useEffect(() => {
    if (folderRef.current) { folderRef.current.setAttribute("webkitdirectory", ""); folderRef.current.setAttribute("directory", ""); }
  }, []);

  const [drag, setDrag] = useState(false);
  const [upResults, setUpResults] = useState<UploadResultRow[] | null>(null);
  const [imp, setImp] = useState<{ total: number; done: number; keywords: number; sources: Set<string>; errors: string[]; skipped: string[] } | null>(null);
  const [q, setQ] = useState("");
  const [doneFilter, setDoneFilter] = useState<DoneFilter>("all");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");
  const [groupSimilar, setGroupSimilar] = useState(false);
  const [sortField, setSortField] = useState<SortField>("impressions");
  const [sortDesc, setSortDesc] = useState(true);
  const [openDetail, setOpenDetail] = useState<Record<string, boolean>>({});
  const [editUrl, setEditUrl] = useState<Record<string, string>>({});
  const [recs, setRecs] = useState<KwNoPageRec[] | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ["kw-no-page", cid], queryFn: () => api.getKeywordsNoPage(cid), enabled: !!cid });
  const rows = data?.rows || [];
  const summary = data?.summary;

  // ---- Upload (CSV / TSV / XLSX / XLS / ZIP, many files, folder, drag-drop) ----
  async function ingest(fileList: File[]) {
    const files = fileList.filter((f) => isSupported(f.name));
    const unsupported = fileList.filter((f) => !isSupported(f.name)).map((f) => f.name);
    if (files.length === 0) { setImp({ total: 0, done: 0, keywords: 0, sources: new Set(), errors: [], skipped: unsupported.length ? unsupported : ["לא נבחרו קבצים נתמכים (CSV, TSV, XLSX, XLS, ZIP)"] }); return; }
    const state = { total: 0, done: 0, keywords: 0, sources: new Set<string>(), errors: [] as string[], skipped: [...unsupported] };
    setImp({ ...state, sources: new Set(state.sources) });
    // Expand every file (xlsx→sheets, zip→entries) first so we know the real total.
    const parsed: { name: string; text: string }[] = [];
    for (const f of files) {
      try { const r = await expandFile(f); parsed.push(...r.files); state.skipped.push(...r.skipped); }
      catch { state.errors.push(f.name); }
    }
    state.total = parsed.length;
    setImp({ ...state, sources: new Set(state.sources) });
    const results: UploadResultRow[] = state.errors.map((f) => ({ file: f, error: "לא ניתן לקרוא את הקובץ" }));
    setUpResults([...results]);
    for (const p of parsed) {
      try {
        const res = await api.uploadData(cid, p.name, p.text);
        if (res.source) state.sources.add(res.source);
        state.keywords += res.row_count || 0;
        results.push({ file: p.name, source: res.source, data_type: res.data_type, row_count: res.row_count, date_from: res.date_from, date_to: res.date_to });
      } catch (e) { state.errors.push(p.name); results.push({ file: p.name, error: (e as Error).message?.slice(0, 120) }); }
      setUpResults([...results]);
      state.done += 1;
      setImp({ ...state, sources: new Set(state.sources) });
    }
    qc.invalidateQueries({ queryKey: ["datasets", cid] });
    refetch();
  }
  function onPick(e: React.ChangeEvent<HTMLInputElement>) { const fs = Array.from(e.target.files || []); if (e.target) e.target.value = ""; if (fs.length) ingest(fs); }
  function onDrop(e: React.DragEvent) { e.preventDefault(); setDrag(false); const fs = Array.from(e.dataTransfer.files || []); if (fs.length) ingest(fs); }

  // ---- "נכתב" toggle (optimistic) ----
  const mark = useMutation({
    mutationFn: (p: { keyword: string; url: string | null }) => api.setKwWritten(cid, p.keyword, p.url),
    onMutate: (p) => patchRow(p.keyword, { written: true, written_url: p.url }),
    onError: () => refetch(),
  });
  const unmark = useMutation({
    mutationFn: (keyword: string) => api.clearKwWritten(cid, keyword),
    onMutate: (keyword) => patchRow(keyword, { written: false, written_url: null }),
    onError: () => refetch(),
  });
  function patchRow(keyword: string, patch: Partial<KwNoPageRow>) {
    qc.setQueryData(["kw-no-page", cid], (old: any) => old ? { ...old, rows: old.rows.map((r: KwNoPageRow) => r.keyword === keyword ? { ...r, ...patch } : r) } : old);
  }

  const analyze = useMutation({
    mutationFn: (subset: KwNoPageRow[]) => api.analyzeKeywordsNoPage(cid, subset),
    onSuccess: (res) => setRecs(res.recommendations),
  });

  // ---- Filter + sort ----
  const filtered = useMemo(() => {
    let list = rows;
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((r) => r.keyword.toLowerCase().includes(s));
    if (doneFilter !== "all") list = list.filter((r) => doneFilter === "written" ? r.written : !r.written);
    if (matchFilter !== "all") list = list.filter((r) => r.match === matchFilter);
    const statusRank: Record<KwMatch, number> = { no_page: 0, needs_check: 1, to_improve: 2 };
    const dir = sortDesc ? 1 : -1;
    list = [...list].sort((a, b) => {
      if (sortField === "keyword") return a.keyword.localeCompare(b.keyword, "he") * dir;
      if (sortField === "status") return (statusRank[a.match] - statusRank[b.match]) * dir || (b.impressions ?? -1) - (a.impressions ?? -1);
      return ((b.impressions ?? -1) - (a.impressions ?? -1)) * dir;
    });
    if (groupSimilar) {
      const groups = new Map<string, KwNoPageRow[]>();
      for (const r of list) { const g = sig(r.keyword) || r.keyword; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(r); }
      list = [...groups.values()].flat();
      return list.map((r, i, arr) => ({ r, grp: sig(r.keyword), first: i === 0 || sig(arr[i - 1].keyword) !== sig(r.keyword) }));
    }
    return list.map((r) => ({ r, grp: "", first: false }));
  }, [rows, q, doneFilter, matchFilter, sortField, sortDesc, groupSimilar]);

  const groupSizes = useMemo(() => {
    const m = new Map<string, number>();
    if (groupSimilar) for (const r of rows) { const g = sig(r.keyword); m.set(g, (m.get(g) || 0) + 1); }
    return m;
  }, [rows, groupSimilar]);

  // ---- Reveal a keyword from an AI recommendation link ----
  function reveal(keyword: string) {
    const r = rows.find((x) => x.keyword === keyword);
    if (!r) return;
    setQ(""); setDoneFilter("all"); setMatchFilter("all");
    setHighlight(keyword);
    setTimeout(() => {
      rowRefs.current.get(keyword)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    setTimeout(() => setHighlight((h) => (h === keyword ? null : h)), 2600);
  }

  const busy = imp && imp.total > 0 && imp.done < imp.total;

  return (
    <div>
      <PageHeader title="מילים ללא עמוד" subtitle={client ? `${client.name} · זיהוי ביטויים שאין להם עמוד ייעודי באתר` : "מילים ללא עמוד"} />
      <DataSourceBanner cid={cid} match={["Search Console", "ZEFO"]} />
      {/* After an upload: how much data arrived, by source and data type */}
      {upResults && imp && <UploadSummary results={upResults} running={{ done: imp.done, total: imp.total }} skipped={imp.skipped} onClose={() => setUpResults(null)} />}

      {/* Upload */}
      <div
        className={`card mb-4 border-2 border-dashed transition ${drag ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <p className="text-sm text-slate-600 mb-3">
          העלה דוחות מילות מפתח מ-Google Search Console ומ-ZEFO. נתמכים: <b>CSV, TSV, XLSX, XLS, ZIP</b> — קובץ בודד, כמה קבצים, תיקייה שלמה או גרירה לכאן.
          אין צורך בטווחי תאריכים — כל הקבצים נקראים, הביטויים הכפולים מאוחדים (תוך שמירת המקורות), והמערכת מזהה לבד את מקור הדוח.
        </p>
        <div className="flex flex-wrap gap-2">
          <label className="btn-primary cursor-pointer inline-flex">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />} {busy ? "מייבא…" : "בחר קבצים"}
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.zip" className="hidden" multiple onChange={onPick} disabled={!!busy} />
          </label>
          <label className="btn-secondary cursor-pointer inline-flex">
            <FolderUp size={18} /> העלה תיקייה
            <input ref={folderRef} type="file" className="hidden" multiple onChange={onPick} />
          </label>
        </div>
        {imp && (
          <div className="mt-3 text-sm">
            {busy ? (
              <span className="text-slate-600">מייבא {imp.done}/{imp.total} קבצים…</span>
            ) : (
              <span className="text-emerald-700">הייבוא הושלם. הסיכום מופיע בראש העמוד.</span>
            )}
          </div>
        )}
      </div>

      {summary && !summary.pages_data_available && rows.length > 0 && (
        <div className="mb-4 flex items-start gap-2 text-xs rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>חסרים נתוני עמודים (כותרת / H1 / תיאור מטא), לכן בדיקת ההתאמה מסומנת "דורש בדיקה". הרץ סריקת אתר (לשונית "עמודים") או ייבא דוח עמודים כדי לבדוק התאמה.</span>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="card text-center py-10 text-slate-500 text-sm">
          <FileSearch size={36} className="mx-auto mb-2 text-slate-300" />
          עדיין אין מילות מפתח. העלה דוח מ-Search Console או מ-ZEFO כדי להתחיל.
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="card mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input py-1 text-sm pr-7 w-48" placeholder="חפש מילת מפתח" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <select className="input py-1 text-sm w-auto" value={doneFilter} onChange={(e) => setDoneFilter(e.target.value as DoneFilter)}>
                <option value="all">בוצע: הכול</option>
                <option value="written">נכתב</option>
                <option value="unwritten">טרם נכתב</option>
              </select>
              <select className="input py-1 text-sm w-auto" value={matchFilter} onChange={(e) => setMatchFilter(e.target.value as MatchFilter)}>
                <option value="all">התאמה: הכול</option>
                <option value="no_page">ללא עמוד ייעודי</option>
                <option value="to_improve">עמוד לשיפור</option>
                <option value="needs_check">דורש בדיקה</option>
              </select>
              <button className={`btn-secondary text-xs py-1 px-2 ${groupSimilar ? "border-brand-400 text-brand-700 bg-brand-50" : ""}`} onClick={() => setGroupSimilar((g) => !g)} title="קבץ ביטויים דומים (ללא מחיקה/איחוד של הנתונים)">
                <Layers3 size={13} /> ביטויים דומים
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500">מיין לפי</span>
              <select className="input py-1 text-sm w-auto" value={sortField} onChange={(e) => setSortField(e.target.value as SortField)}>
                <option value="impressions">חשיפות</option>
                <option value="keyword">מילת מפתח</option>
                <option value="status">סטטוס בדיקה</option>
              </select>
              <button className="btn-secondary text-xs py-1 px-2" onClick={() => setSortDesc((d) => !d)} title="הפוך סדר">{sortDesc ? "גבוה→נמוך" : "נמוך→גבוה"}</button>
              <button className="btn-primary text-xs py-1 px-3" onClick={() => { setRecs(null); analyze.mutate(filtered.map((f) => f.r)); }} disabled={analyze.isPending || filtered.length === 0}>
                {analyze.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} ניתוח והמלצות AI ({filtered.length})
              </button>
            </div>
          </div>

          {/* AI recommendations */}
          {analyze.isError && <div className="card mb-4 text-sm text-rose-600">{(analyze.error as any)?.message}</div>}
          {recs && (
            <div className="card mb-4 border-r-4 border-r-brand-400">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2 text-slate-800"><Sparkles size={17} className="text-brand-600" /> המלצות AI <span className="text-xs font-normal text-slate-400">({analyze.data?.analyzed} ביטויים נותחו)</span></h3>
                <button className="text-slate-400 hover:text-slate-700" onClick={() => setRecs(null)}><X size={16} /></button>
              </div>
              {recs.length === 0 ? <p className="text-sm text-slate-400">לא הוחזרו המלצות.</p> : (
                <ul className="space-y-3">
                  {recs.map((rec, i) => (
                    <li key={i} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                        <span className="font-medium text-slate-800">{rec.title}</span>
                        <div className="flex items-center gap-2">
                          <span className="badge bg-slate-100 text-slate-700">{ACTION_LABEL[rec.action] || rec.action}</span>
                          <span className={`badge ${PRIORITY_CLS[rec.priority] || PRIORITY_CLS.low}`}>עדיפות {rec.priority === "high" ? "גבוהה" : rec.priority === "medium" ? "בינונית" : "נמוכה"}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {rec.keywords.map((k) => (
                          <button key={k} className="badge bg-brand-50 text-brand-700 hover:bg-brand-100 inline-flex items-center gap-1" onClick={() => reveal(k)} title="עבור לשורה בטבלה">
                            <Link2 size={11} /> {k}
                          </button>
                        ))}
                      </div>
                      <p className="text-sm text-slate-600">{rec.explanation}</p>
                      {rec.content_direction && <p className="text-sm text-slate-500 mt-1"><b className="text-slate-600">כיוון תוכן:</b> {rec.content_direction}</p>}
                      {rec.target_page && <a href={rec.target_page} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1 mt-1"><ExternalLink size={11} /> עמוד מומלץ לשיפור</a>}
                      <div className="text-xs text-slate-400 mt-1">{rec.priority_reason}</div>
                      {rec.uncertainty && <div className="text-xs text-amber-600 mt-1">אי-ודאות: {rec.uncertainty}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Table */}
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-xs text-slate-500 border-b border-slate-200">
                  <th className="py-2 px-3 font-medium">מילת מפתח</th>
                  <th className="py-2 px-3 font-medium">חשיפות</th>
                  <th className="py-2 px-3 font-medium">עמודים שמופיעים עבור הביטוי</th>
                  <th className="py-2 px-3 font-medium">בדיקת התאמה</th>
                  <th className="py-2 px-3 font-medium">בוצע</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ r, grp, first }) => {
                  const mm = MATCH_META[r.match];
                  const isOpen = openDetail[r.keyword];
                  const grpSize = groupSizes.get(grp) || 0;
                  return (
                    <Fragment key={r.keyword}>
                      {groupSimilar && first && grpSize > 1 && (
                        <tr><td colSpan={5} className="bg-slate-50 text-[11px] text-slate-400 px-3 py-1 border-t border-slate-100">קבוצת ביטויים דומים ({grpSize})</td></tr>
                      )}
                      <tr
                        ref={(el) => { rowRefs.current.set(r.keyword, el); }}
                        className={`border-b border-slate-100 align-top transition-colors ${r.written ? "bg-emerald-50/70" : ""} ${highlight === r.keyword ? "ring-2 ring-brand-400 ring-inset" : ""}`}
                      >
                        <td className="py-2 px-3 font-medium text-slate-800">{r.keyword}</td>
                        <td className="py-2 px-3 whitespace-nowrap">{r.impressions == null ? <span className="text-slate-400">אין נתון</span> : r.impressions.toLocaleString()}</td>
                        <td className="py-2 px-3">
                          {r.pages.length === 0 ? (
                            <span className="text-slate-400 text-xs">{r.pages_missing ? "אין שיוך עמוד בדוח" : "—"}</span>
                          ) : (
                            <ul className="space-y-0.5">
                              {r.pages.map((p, i) => (
                                <li key={i} className="text-xs">
                                  <a href={p.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-1"><ExternalLink size={10} className="shrink-0" /> {p.name}</a>
                                  <span className="text-slate-400"> · {p.metric} {p.position == null ? "—" : Number(p.position).toFixed(1)} · {p.source}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <button className={`badge border inline-flex items-center gap-1 ${mm.cls}`} onClick={() => setOpenDetail((o) => ({ ...o, [r.keyword]: !isOpen }))}>
                            <mm.Icon size={11} /> {mm.label} {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                          </button>
                          {isOpen && r.detail && (
                            <div className="mt-2 text-xs bg-slate-50 rounded-lg p-2 space-y-1 max-w-sm">
                              {r.detail.page && <div><a href={r.detail.page} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-1"><ExternalLink size={10} /> {r.detail.name || r.detail.page}</a></div>}
                              {r.detail.title != null && <div><span className="text-slate-400">כותרת SEO:</span> {r.detail.title || "—"}</div>}
                              {r.detail.meta != null && <div><span className="text-slate-400">תיאור מטא:</span> {r.detail.meta || "—"}</div>}
                              {r.detail.h1 != null && <div><span className="text-slate-400">H1:</span> {r.detail.h1 || "—"}</div>}
                              <div className="text-slate-500 pt-1 border-t border-slate-200">{r.detail.reason}</div>
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          {r.written ? (
                            <div className="flex items-center gap-1.5">
                              <button className="badge bg-emerald-100 text-emerald-700 inline-flex items-center gap-1" onClick={() => unmark.mutate(r.keyword)} title="בטל סימון"><Check size={12} /> נכתב ✓</button>
                              {editUrl[r.keyword] != null ? (
                                <input autoFocus className="input py-0.5 text-xs w-40" placeholder="כתובת העמוד" defaultValue={r.written_url || ""}
                                  onBlur={(e) => { mark.mutate({ keyword: r.keyword, url: e.target.value.trim() || null }); setEditUrl((s) => { const n = { ...s }; delete n[r.keyword]; return n; }); }}
                                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                              ) : r.written_url ? (
                                <a href={r.written_url} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-0.5 max-w-[140px] truncate"><ExternalLink size={10} className="shrink-0" /> עמוד</a>
                              ) : null}
                              <button className="text-slate-400 hover:text-slate-700 p-0.5" title="צרף/ערוך כתובת עמוד" onClick={() => setEditUrl((s) => ({ ...s, [r.keyword]: r.written_url || "" }))}><Pencil size={12} /></button>
                            </div>
                          ) : (
                            <button className="btn-secondary text-xs py-0.5 px-2" onClick={() => mark.mutate({ keyword: r.keyword, url: null })}>סמן כנכתב</button>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="text-center text-slate-400 text-sm py-6">אין ביטויים התואמים לסינון.</p>}
          </div>
          <div className="text-xs text-slate-400 mt-2 flex items-center justify-between">
            <span>מציג {filtered.length} מתוך {rows.length} ביטויים</span>
            <button className="hover:text-brand-600 inline-flex items-center gap-1" onClick={() => refetch()} disabled={isFetching}>{isFetching ? <Loader2 size={12} className="animate-spin" /> : null} רענן נתונים</button>
          </div>
        </>
      )}
    </div>
  );
}
