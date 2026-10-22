import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Database, RefreshCw, Upload } from "lucide-react";
import * as api from "../api";
import type { UploadedDataset } from "../api";

/**
 * Small banner shown at the top of a tab: which uploaded files/data this tab relates to,
 * and when they were uploaded — so the user knows it reflects their latest uploads.
 * `match` filters datasets by source (substring, case-insensitive); omit to show all.
 */
export default function DataSourceBanner({ cid, match }: { cid: number; match?: string[] }) {
  const qc = useQueryClient();
  const { data: datasets, isFetching } = useQuery({ queryKey: ["datasets", cid], queryFn: () => api.listDatasets(cid), enabled: !!cid });

  const rel = (datasets || []).filter((d) => !match || match.some((m) => (d.source || "").toLowerCase().includes(m.toLowerCase())));
  const latest: UploadedDataset | undefined = rel[0]; // listDatasets is newest-first

  return (
    <div className="mb-4 flex items-center gap-2 text-xs rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <Database size={14} className={latest ? "text-brand-600" : "text-slate-400"} />
      {latest ? (
        <span className="text-slate-600">
          מבוסס גם על נתונים שהועלו: <span className="font-medium text-slate-800">{latest.source}</span>
          {latest.filename ? ` · ${latest.filename}` : ""}
          {latest.date_from ? ` · תקופה ${latest.date_from}–${latest.date_to}` : ""}
          {` · הועלה ${new Date(latest.created_at).toLocaleDateString("he-IL")}`}
          {rel.length > 1 ? ` · ועוד ${rel.length - 1} קבצים` : ""}
        </span>
      ) : (
        <span className="text-slate-500">לא הועלו קבצים רלוונטיים ללשונית זו.</span>
      )}
      <div className="flex-1" />
      <button className="text-slate-500 hover:text-brand-600 inline-flex items-center gap-1" title="עדכן" onClick={() => qc.invalidateQueries({ queryKey: ["datasets", cid] })}>
        <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /> עדכן
      </button>
      <Link to={`/clients/${cid}/upload`} className="text-brand-600 hover:underline inline-flex items-center gap-1"><Upload size={13} /> העלאת נתונים</Link>
    </div>
  );
}
