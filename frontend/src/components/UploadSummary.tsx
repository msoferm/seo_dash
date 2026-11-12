import { useState } from "react";
import { CheckCircle2, Loader2, X, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";

export interface UploadResultRow {
  file: string; source?: string; data_type?: string; row_count?: number;
  date_from?: string | null; date_to?: string | null; error?: string;
}

/** Shown at the top of the page after uploading files: how much data arrived, by source and type. */
export default function UploadSummary({ results, running, skipped = [], onClose }: {
  results: UploadResultRow[]; running?: { done: number; total: number } | null; skipped?: string[]; onClose?: () => void;
}) {
  const [showFiles, setShowFiles] = useState(false);
  const ok = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  const totalRows = ok.reduce((s, r) => s + (r.row_count || 0), 0);
  const groups = new Map<string, { source: string; type: string; files: number; rows: number; from: string | null; to: string | null }>();
  for (const r of ok) {
    const k = `${r.source || "לא זוהה"}|${r.data_type || "—"}`;
    const g = groups.get(k) || { source: r.source || "לא זוהה", type: r.data_type || "—", files: 0, rows: 0, from: null, to: null };
    g.files++; g.rows += r.row_count || 0;
    if (r.date_from && (!g.from || r.date_from < g.from)) g.from = r.date_from;
    if (r.date_to && (!g.to || r.date_to > g.to)) g.to = r.date_to;
    groups.set(k, g);
  }
  const busy = !!running && running.done < running.total;

  return (
    <div className={`card mb-4 border-r-4 ${failed.length ? "border-r-amber-400" : "border-r-emerald-400"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-slate-800 flex items-center gap-2">
          {busy ? <Loader2 size={18} className="animate-spin text-brand-600" /> : <CheckCircle2 size={18} className="text-emerald-600" />}
          {busy ? `מעלה קבצים… ${running!.done}/${running!.total}` : "סיכום ההעלאה"}
          <span className="font-normal text-slate-600">· הגיעו <b>{totalRows.toLocaleString()}</b> שורות נתונים מ-{ok.length} קבצים</span>
        </div>
        {onClose && !busy && <button className="text-slate-400 hover:text-slate-700" onClick={onClose} title="סגור"><X size={16} /></button>}
      </div>

      {groups.size > 0 && (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead><tr className="text-right text-xs text-slate-500 border-b border-slate-200">
              <th className="py-1.5 px-2 font-medium">מקור</th><th className="py-1.5 px-2 font-medium">סוג הנתון</th>
              <th className="py-1.5 px-2 font-medium">קבצים</th><th className="py-1.5 px-2 font-medium">שורות</th><th className="py-1.5 px-2 font-medium">תקופה</th>
            </tr></thead>
            <tbody>
              {[...groups.values()].map((g) => (
                <tr key={`${g.source}|${g.type}`} className="border-b border-slate-100">
                  <td className="py-1.5 px-2 font-medium text-brand-700">{g.source}</td>
                  <td className="py-1.5 px-2">{g.type}</td>
                  <td className="py-1.5 px-2">{g.files}</td>
                  <td className="py-1.5 px-2 font-semibold">{g.rows.toLocaleString()}</td>
                  <td className="py-1.5 px-2 text-xs text-slate-500">{g.from ? `${g.from} – ${g.to}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {failed.length > 0 && (
        <div className="mt-2 text-xs text-rose-700 flex items-start gap-1"><AlertTriangle size={13} className="shrink-0 mt-0.5" /> נכשלו {failed.length} קבצים: {failed.map((f) => `${f.file}${f.error ? ` (${f.error})` : ""}`).join(", ")}</div>
      )}
      {skipped.length > 0 && <div className="mt-1 text-xs text-amber-700">דולגו (פורמט לא נתמך): {skipped.join(", ")}</div>}

      {results.length > 0 && (
        <button className="mt-2 text-xs text-slate-500 hover:text-brand-600 inline-flex items-center gap-1" onClick={() => setShowFiles((s) => !s)}>
          {showFiles ? <ChevronUp size={12} /> : <ChevronDown size={12} />} פירוט לפי קובץ ({results.length})
        </button>
      )}
      {showFiles && (
        <ul className="mt-1 text-xs text-slate-600 divide-y divide-slate-100">
          {results.map((r, i) => (
            <li key={i} className="py-1 flex flex-wrap gap-x-2">
              <span className="font-medium text-slate-800">{r.file}</span>
              {r.error ? <span className="text-rose-600">נכשל: {r.error}</span>
                : <span>{r.source} · {r.data_type || "—"} · {(r.row_count || 0).toLocaleString()} שורות{r.date_from ? ` · ${r.date_from} – ${r.date_to}` : ""}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
