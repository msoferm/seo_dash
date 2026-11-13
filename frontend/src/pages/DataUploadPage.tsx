import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2, FileSpreadsheet, Trash2, FolderUp, Download, Eye, X, CalendarRange, Pencil, Check, Sparkles } from "lucide-react";
import * as api from "../api";
import type { UploadedDataset } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import UploadSummary, { type UploadResultRow } from "../components/UploadSummary";
import SiteScanPanel from "../components/SiteScanPanel";
import { NewDataNotice } from "../components/DataSourceBanner";
import { expandFile, isSupported } from "../lib/fileImport";
import { parseCsv, downloadText } from "../lib/csv";
import { type PeriodChoice, periodOf, periodText, loadChoice, saveChoice } from "../lib/period";

/** Choose the period the files cover: auto / last 3, 6, 12 months / a free range. */
function PeriodPicker({ value, onChange }: { value: PeriodChoice; onChange: (c: PeriodChoice) => void }) {
  const btn = (active: boolean) => `text-xs py-1 px-2.5 rounded-full border ${active ? "bg-brand-600 text-white border-brand-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`;
  const custom = value.kind === "custom" ? value : { kind: "custom" as const, from: "", to: "" };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button className={btn(value.kind === "auto")} onClick={() => onChange({ kind: "auto" })}>זיהוי אוטומטי</button>
      {([3, 6, 12] as const).map((m) => (
        <button key={m} className={btn(value.kind === "months" && value.months === m)} onClick={() => onChange({ kind: "months", months: m })}>{m} חודשים</button>
      ))}
      <button className={btn(value.kind === "custom")} onClick={() => onChange(custom)}>בחירת תאריכים</button>
      {value.kind === "custom" && (
        <span className="inline-flex items-center gap-1">
          <input type="date" className="input py-1 text-xs w-36" value={custom.from} max={custom.to || undefined} onChange={(e) => onChange({ ...custom, from: e.target.value })} />
          <span className="text-slate-400">עד</span>
          <input type="date" className="input py-1 text-xs w-36" value={custom.to} min={custom.from || undefined} onChange={(e) => onChange({ ...custom, to: e.target.value })} />
        </span>
      )}
    </div>
  );
}

/** View an uploaded file online (the stored original, or rebuilt from the saved rows). */
function FileViewer({ d, onClose }: { d: UploadedDataset; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["dataset-csv", d.id], queryFn: () => api.getDatasetCsv(d) });
  const [q, setQ] = useState("");
  const table = data ? parseCsv(data.csv) : [];
  const head = table[0] || [];
  const body = table.slice(1).filter((r) => !q.trim() || r.some((c) => c.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 p-3 border-b border-slate-200">
          <div className="font-semibold text-slate-800 flex items-center gap-2"><FileSpreadsheet size={17} /> {d.filename || "קובץ"} <span className="text-xs font-normal text-slate-500">{table.length ? `${(table.length - 1).toLocaleString()} שורות` : ""}</span></div>
          <div className="flex items-center gap-2">
            <input className="input py-1 text-sm w-48" placeholder="חיפוש בקובץ" value={q} onChange={(e) => setQ(e.target.value)} />
            {data && <button className="btn-secondary text-xs" onClick={() => downloadText(d.filename || `file-${d.id}.csv`, data.csv)}><Download size={13} /> הורד</button>}
            <button className="text-slate-400 hover:text-slate-700" onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        {data?.rebuilt && <div className="text-xs text-amber-800 bg-amber-50 px-3 py-1.5">הקובץ הועלה לפני שהמערכת שמרה קבצים מקוריים, ולכן הוא שוחזר מהנתונים שנשמרו. מוצגות רק העמודות שזוהו. מעכשיו כל קובץ נשמר כמו שהוא.</div>}
        <div className="overflow-auto flex-1">
          {isLoading ? <Spinner /> : error ? <div className="p-4 text-sm text-rose-600">{(error as Error).message}</div> : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50"><tr>{head.map((h, i) => <th key={i} className="text-right py-1.5 px-2 font-medium text-slate-600 border-b border-slate-200 whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>
                {body.slice(0, 2000).map((r, i) => <tr key={i} className="border-b border-slate-100">{head.map((_, j) => <td key={j} className="py-1 px-2 whitespace-nowrap">{r[j]}</td>)}</tr>)}
              </tbody>
            </table>
          )}
          {body.length > 2000 && <div className="text-xs text-slate-500 p-2">מוצגות 2,000 השורות הראשונות. להצגת הכל, הורד את הקובץ.</div>}
        </div>
      </div>
    </div>
  );
}

function DatasetRow({ d, onRemove }: { d: UploadedDataset; onRemove: () => void }) {
  const qc = useQueryClient();
  const [view, setView] = useState(false);
  const [edit, setEdit] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [choice, setChoice] = useState<PeriodChoice>(d.date_from && d.date_to ? { kind: "custom", from: d.date_from, to: d.date_to } : { kind: "auto" });
  const savePeriod = useMutation({
    mutationFn: () => api.updateDatasetPeriod(d.id, periodOf(choice) || { date_from: null, date_to: null, period_label: null }),
    onSuccess: () => { setEdit(false); qc.invalidateQueries({ queryKey: ["datasets", d.client_id] }); },
  });
  const dl = useMutation({ mutationFn: async () => { const r = await api.getDatasetCsv(d); downloadText(d.filename || `file-${d.id}.csv`, r.csv); } });
  const mapped = d.mapping ? Object.entries(d.mapping).filter(([, v]) => v && v !== "null").map(([k]) => k) : [];
  const newKws = d.new_keywords || [];
  return (
    <li className="py-3 flex items-start gap-3">
      <FileSpreadsheet size={18} className="text-slate-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-900 flex items-center gap-2 flex-wrap">
          {d.filename || "קובץ"}
          {newKws.length > 0 && (
            <button className="badge bg-violet-100 text-violet-700 inline-flex items-center gap-1" onClick={() => setShowNew((s) => !s)}><Sparkles size={11} /> {newKws.length} מילות מפתח חדשות</button>
          )}
          {(d.new_pages?.length || 0) > 0 && <span className="badge bg-violet-50 text-violet-700">{d.new_pages!.length} דפים חדשים</span>}
        </div>
        <div className="text-xs text-slate-500">
          <span className="text-brand-600">{d.source}</span>{d.data_type ? ` · ${d.data_type}` : ""} · {d.row_count.toLocaleString()} שורות
          {d.kw_count ? <> · <b className="text-slate-700">{d.kw_count.toLocaleString()} מילות מפתח</b></> : ""} · הועלה {new Date(d.created_at).toLocaleDateString("he-IL")}
        </div>
        <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
          <CalendarRange size={12} /> תקופה: {periodText(d) || <span className="text-amber-700">לא ידועה</span>}
          {!edit && <button className="text-brand-600 hover:underline inline-flex items-center gap-0.5 mr-1" onClick={() => setEdit(true)}><Pencil size={11} /> שנה</button>}
        </div>
        {edit && (
          <div className="mt-1.5 bg-slate-50 rounded-lg p-2 flex flex-wrap items-center gap-2">
            <PeriodPicker value={choice} onChange={setChoice} />
            <button className="btn-primary text-xs py-1 px-2" disabled={savePeriod.isPending} onClick={() => savePeriod.mutate()}>{savePeriod.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} שמור תקופה</button>
            <button className="text-xs text-slate-500" onClick={() => setEdit(false)}>ביטול</button>
          </div>
        )}
        {mapped.length > 0 && <div className="text-xs text-slate-400 mt-0.5">עמודות שזוהו: {mapped.join(", ")}</div>}
        {showNew && <div className="mt-1 text-xs bg-violet-50 border border-violet-200 rounded p-2 text-violet-900">{newKws.join(", ")}</div>}
        {dl.isError && <div className="text-xs text-rose-600">{(dl.error as Error).message}</div>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button className="text-slate-500 hover:text-brand-600 p-1 inline-flex items-center gap-1 text-xs" title="צפה בקובץ" onClick={() => setView(true)}><Eye size={15} /> צפייה</button>
        <button className="text-slate-500 hover:text-brand-600 p-1 inline-flex items-center gap-1 text-xs" title="הורד את הקובץ" disabled={dl.isPending} onClick={() => dl.mutate()}>{dl.isPending ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} הורדה</button>
        <button className="text-slate-400 hover:text-rose-600 p-1" title="מחק" onClick={onRemove}><Trash2 size={16} /></button>
      </div>
      {view && <FileViewer d={d} onClose={() => setView(false)} />}
    </li>
  );
}

export default function DataUploadPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<UploadResultRow[] | null>(null);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [period, setPeriodState] = useState<PeriodChoice>(() => loadChoice(cid));
  const setPeriod = (c: PeriodChoice) => { setPeriodState(c); saveChoice(cid, c); };
  useEffect(() => {
    if (folderRef.current) { folderRef.current.setAttribute("webkitdirectory", ""); folderRef.current.setAttribute("directory", ""); }
  }, []);

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: datasets, isLoading } = useQuery({ queryKey: ["datasets", cid], queryFn: () => api.listDatasets(cid), enabled: !!cid });
  const invalidate = () => { for (const k of ["datasets", "uploaded-kws", "kw-seen"]) qc.invalidateQueries({ queryKey: [k, cid] }); };

  const remove = useMutation({ mutationFn: (id: number) => api.deleteDataset(id), onSuccess: invalidate });
  const customInvalid = period.kind === "custom" && (!period.from || !period.to);

  // Any number of files / a folder; CSV, TSV, XLSX, XLS and ZIP (each sheet / zip entry is its own dataset).
  async function ingest(fileList: File[]) {
    const files = fileList.filter((f) => isSupported(f.name));
    const skip = fileList.filter((f) => !isSupported(f.name)).map((f) => f.name);
    const out: UploadResultRow[] = [];
    const parsed: { name: string; text: string }[] = [];
    for (const f of files) {
      try { const r = await expandFile(f); parsed.push(...r.files); skip.push(...r.skipped); }
      catch { out.push({ file: f.name, error: "לא ניתן לקרוא את הקובץ" }); }
    }
    const per = periodOf(period);
    setSkipped(skip); setResults([...out]); setProg({ done: 0, total: parsed.length });
    for (const [i, f] of parsed.entries()) {
      try {
        const r = await api.uploadData(cid, f.name, f.text, per);
        out.push({ file: f.name, source: r.source, data_type: r.data_type, row_count: r.row_count, date_from: r.date_from, date_to: r.date_to, kw_count: r.kw_count, new_keywords: r.new_keywords, new_pages: r.new_pages });
      } catch (e) { out.push({ file: f.name, error: (e as Error).message?.slice(0, 120) }); }
      setResults([...out]); setProg({ done: i + 1, total: parsed.length });
    }
    invalidate();
  }
  const busy = !!prog && prog.done < prog.total;
  function onPick(e: React.ChangeEvent<HTMLInputElement>) { const fs = Array.from(e.target.files || []); e.target.value = ""; if (fs.length) ingest(fs); }

  return (
    <div>
      <PageHeader title="העלאת נתונים" subtitle={client ? `${client.name} · העלה קבצים מכלים נוספים — זיהוי אוטומטי` : "העלאת נתונים"} />
      {/* After an upload: how much data arrived, by source and data type, and what is new */}
      {results && <UploadSummary results={results} running={prog} skipped={skipped} onClose={() => { setResults(null); setProg(null); }} />}
      {/* Pinned: what is new since the previous upload / scan */}
      <div className="mb-4"><NewDataNotice cid={cid} /></div>
      <SiteScanPanel cid={cid} />

      <div className="card mb-6">
        <p className="text-sm text-slate-600 mb-3">העלה קבצים מכל כלי (Search Console, ZEFO, GA4, Keyword Planner ועוד). נתמכים: <b>CSV, TSV, XLSX, XLS, ZIP</b> — כמה קבצים יחד או תיקייה שלמה. המערכת מזהה לבד את המקור והעמודות, ובסיום מציגה למעלה כמה נתונים הגיעו, מאיזה סוג, ומה חדש בהם.</p>
        <div className="mb-3">
          <div className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5"><CalendarRange size={15} className="text-brand-600" /> איזו תקופה הקבצים מכסים?</div>
          <PeriodPicker value={period} onChange={setPeriod} />
          <p className="text-xs text-slate-400 mt-1">
            {period.kind === "auto" ? "המערכת תנסה לזהות את התקופה מתוך הקובץ. בייצוא של Search Console התקופה בדרך כלל לא כתובה בקובץ, ולכן עדיף לבחור אותה." : `התקופה תישמר עם כל קובץ שתעלה: ${periodText(periodOf(period) || { date_from: null, date_to: null }) || "בחר תאריך התחלה וסיום"}. אפשר לשנות אותה אחר כך ברשימת הקבצים.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`btn-primary cursor-pointer inline-flex ${customInvalid ? "opacity-50 pointer-events-none" : ""}`}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />} {busy ? "מזהה ומעלה..." : "בחר קבצים להעלאה"}
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.zip" multiple className="hidden" onChange={onPick} disabled={busy || customInvalid} />
          </label>
          <label className={`btn-secondary cursor-pointer inline-flex ${customInvalid ? "opacity-50 pointer-events-none" : ""}`}>
            <FolderUp size={18} /> העלה תיקייה שלמה
            <input ref={folderRef} type="file" className="hidden" onChange={onPick} multiple disabled={busy || customInvalid} />
          </label>
        </div>
      </div>

      <div className="card">
        <h3 className="font-semibold flex items-center gap-2 text-slate-800 mb-3"><FileSpreadsheet size={18} /> קבצים שהועלו</h3>
        {isLoading ? (
          <Spinner />
        ) : (datasets || []).length === 0 ? (
          <p className="text-slate-400 text-sm">עדיין לא הועלו קבצים.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(datasets || []).map((d: UploadedDataset) => (
              <DatasetRow key={d.id} d={d} onRemove={() => { if (confirm("למחוק את הקובץ והנתונים שלו?")) remove.mutate(d.id); }} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
