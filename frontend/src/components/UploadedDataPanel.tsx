import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, ChevronDown, ChevronUp } from "lucide-react";
import * as api from "../api";
import type { UploadedRow } from "../api";

const COL_LABEL: Record<string, string> = {
  page: "עמוד", query: "שאילתה", keyword: "מילת מפתח", clicks: "קליקים", impressions: "חשיפות",
  ctr: "CTR", position: "מיקום", sessions: "סשנים", conversions: "המרות",
};
const COL_ORDER = ["page", "query", "keyword", "clicks", "impressions", "ctr", "position", "sessions", "conversions"];

/**
 * Shows the latest uploaded dataset matching `match` (e.g. GSC / GA4) as a clearly-labeled
 * supplement — NOT merged into the live numbers, so there's no double-counting.
 */
export default function UploadedDataPanel({ cid, match, title }: { cid: number; match: string[]; title: string }) {
  const [open, setOpen] = useState(false);
  const { data: datasets } = useQuery({ queryKey: ["datasets", cid], queryFn: () => api.listDatasets(cid), enabled: !!cid });
  const ds = (datasets || []).find((d) => match.some((m) => (d.source || "").toLowerCase().includes(m.toLowerCase())));
  const { data: rows } = useQuery({ queryKey: ["uploaded-rows", ds?.id], queryFn: () => api.listUploadedRows(ds!.id, 50), enabled: !!ds && open });

  if (!ds) return null;

  const cols = COL_ORDER.filter((c) => (rows || []).some((r) => (r as any)[c] != null && (r as any)[c] !== ""));
  const sorted = (rows || []).slice().sort((a, b) => (b.clicks ?? b.sessions ?? 0) - (a.clicks ?? a.sessions ?? 0));

  return (
    <div className="card mb-6">
      <button className="w-full flex items-center justify-between gap-2 text-right" onClick={() => setOpen((o) => !o)}>
        <h3 className="font-semibold flex items-center gap-2 text-slate-800">
          <FileSpreadsheet size={18} className="text-amber-600" /> {title}
          <span className="text-xs font-normal text-slate-400">מתוך הקובץ שהעלית · {ds.source}{ds.date_from ? ` · ${ds.date_from}–${ds.date_to}` : ""} · {ds.row_count} שורות</span>
        </h3>
        {open ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
      </button>
      <p className="text-xs text-slate-400 mt-1">נתונים אלה מוצגים כתוספת מהקובץ שהעלית — אינם מעורבבים בנתונים החיים מגוגל.</p>
      {open && (
        <div className="overflow-x-auto mt-3">
          {sorted.length === 0 ? (
            <p className="text-slate-400 text-sm">טוען / אין שורות להצגה.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  {cols.map((c) => <th key={c} className={`p-2 font-medium ${c === "page" || c === "query" || c === "keyword" ? "text-right" : ""}`}>{COL_LABEL[c]}</th>)}
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 50).map((r: UploadedRow) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    {cols.map((c) => {
                      const v = (r as any)[c];
                      const isText = c === "page" || c === "query" || c === "keyword";
                      const disp = c === "ctr" && v != null ? `${(v * 100).toFixed(1)}%` : (typeof v === "number" ? v.toLocaleString("he-IL") : (v || "—"));
                      return <td key={c} className={`p-2 ${isText ? "text-right text-slate-700 break-all max-w-[280px]" : "text-center text-slate-600"}`}>{disp}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
