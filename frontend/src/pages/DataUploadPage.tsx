import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2, FileSpreadsheet, Trash2, FolderUp } from "lucide-react";
import * as api from "../api";
import type { UploadedDataset } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import UploadSummary, { type UploadResultRow } from "../components/UploadSummary";
import SiteScanPanel from "../components/SiteScanPanel";
import { expandFile, isSupported } from "../lib/fileImport";

export default function DataUploadPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<UploadResultRow[] | null>(null);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  useEffect(() => {
    if (folderRef.current) { folderRef.current.setAttribute("webkitdirectory", ""); folderRef.current.setAttribute("directory", ""); }
  }, []);

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: datasets, isLoading } = useQuery({ queryKey: ["datasets", cid], queryFn: () => api.listDatasets(cid), enabled: !!cid });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["datasets", cid] });

  const remove = useMutation({ mutationFn: (id: number) => api.deleteDataset(id), onSuccess: invalidate });

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
    setSkipped(skip); setResults([...out]); setProg({ done: 0, total: parsed.length });
    for (const [i, f] of parsed.entries()) {
      try {
        const r = await api.uploadData(cid, f.name, f.text);
        out.push({ file: f.name, source: r.source, data_type: r.data_type, row_count: r.row_count, date_from: r.date_from, date_to: r.date_to });
      } catch (e) { out.push({ file: f.name, error: (e as Error).message?.slice(0, 120) }); }
      setResults([...out]); setProg({ done: i + 1, total: parsed.length });
    }
    invalidate();
  }
  const busy = !!prog && prog.done < prog.total;
  function onPick(e: React.ChangeEvent<HTMLInputElement>) { const fs = Array.from(e.target.files || []); e.target.value = ""; if (fs.length) ingest(fs); }

  const mappedFields = (m: Record<string, string> | null) => m ? Object.entries(m).filter(([, v]) => v && v !== "null").map(([k]) => k) : [];

  return (
    <div>
      <PageHeader title="העלאת נתונים" subtitle={client ? `${client.name} · העלה קבצים מכלים נוספים — זיהוי אוטומטי` : "העלאת נתונים"} />
      {/* After an upload: how much data arrived, by source and data type */}
      {results && <UploadSummary results={results} running={prog} skipped={skipped} onClose={() => { setResults(null); setProg(null); }} />}
      <SiteScanPanel cid={cid} />

      <div className="card mb-6">
        <p className="text-sm text-slate-600 mb-3">העלה קבצים מכל כלי (Search Console, ZEFO, GA4, Keyword Planner ועוד). נתמכים: <b>CSV, TSV, XLSX, XLS, ZIP</b> — כמה קבצים יחד או תיקייה שלמה. המערכת מזהה לבד את המקור, העמודות וטווח התאריכים, ובסיום מציגה למעלה כמה נתונים הגיעו ומאיזה סוג.</p>
        <div className="flex flex-wrap gap-2">
          <label className="btn-primary cursor-pointer inline-flex">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />} {busy ? "מזהה ומעלה..." : "בחר קבצים להעלאה"}
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.zip" multiple className="hidden" onChange={onPick} disabled={busy} />
          </label>
          <label className="btn-secondary cursor-pointer inline-flex">
            <FolderUp size={18} /> העלה תיקייה שלמה
            <input ref={folderRef} type="file" className="hidden" onChange={onPick} multiple disabled={busy} />
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
              <li key={d.id} className="py-3 flex items-start gap-3">
                <FileSpreadsheet size={18} className="text-slate-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900">{d.filename || "קובץ"}</div>
                  <div className="text-xs text-slate-400">
                    <span className="text-brand-600">{d.source}</span>{d.data_type ? ` · ${d.data_type}` : ""} · {d.row_count} שורות
                    {d.date_from ? ` · ${d.date_from} – ${d.date_to}` : ""} · {new Date(d.created_at).toLocaleDateString("he-IL")}
                  </div>
                  {d.mapping && <div className="text-xs text-slate-400 mt-0.5">עמודות: {mappedFields(d.mapping).join(", ") || "—"}</div>}
                </div>
                <button className="text-slate-400 hover:text-rose-600 p-1 shrink-0" title="מחק" onClick={() => { if (confirm("למחוק את הקובץ והנתונים שלו?")) remove.mutate(d.id); }}><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
