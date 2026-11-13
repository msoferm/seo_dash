import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Database, RefreshCw, Upload, ScanSearch, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import * as api from "../api";
import type { UploadedDataset } from "../api";
import { periodText } from "../lib/period";

const fmtDate = (d: string) => new Date(d).toLocaleDateString("he-IL");

/** The most recent upload "batch" (files uploaded within 15 minutes of the newest one). */
export function latestBatch(datasets: UploadedDataset[]): UploadedDataset[] {
  if (!datasets.length) return [];
  const t0 = new Date(datasets[0].created_at).getTime();
  return datasets.filter((d) => t0 - new Date(d.created_at).getTime() < 15 * 60000);
}

/** "What is new" in the latest upload batch / scan: new keywords and pages. */
export function NewDataNotice({ cid, compact }: { cid: number; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { data: datasets } = useQuery({ queryKey: ["datasets", cid], queryFn: () => api.listDatasets(cid), enabled: !!cid });
  const { data: scan } = useQuery({ queryKey: ["site-scan", cid], queryFn: () => api.getLatestSiteScan(cid), enabled: !!cid });
  const { data: seen } = useQuery({ queryKey: ["kw-seen", cid], queryFn: () => api.listSeenKeywords(cid), enabled: !!cid });
  const batch = latestBatch(datasets || []);
  const newKws = [...new Set(batch.flatMap((d) => d.new_keywords || []))];
  const newPagesFiles = [...new Set(batch.flatMap((d) => d.new_pages || []))];
  const scanNew = scan?.status === "done" ? scan.new_pages || [] : [];
  const scanGone = scan?.status === "done" ? scan.removed_pages || [] : [];
  const unacked = (seen || []).filter((s) => !s.acknowledged_at).length;
  if (!newKws.length && !newPagesFiles.length && !scanNew.length && !scanGone.length && !unacked) return null;

  const parts: string[] = [];
  if (newKws.length) parts.push(`${newKws.length} מילות מפתח חדשות בהעלאה מ-${fmtDate(batch[0].created_at)}`);
  if (newPagesFiles.length) parts.push(`${newPagesFiles.length} דפים חדשים בקבצים`);
  if (scanNew.length) parts.push(`${scanNew.length} דפים חדשים בסריקת האתר האחרונה`);
  if (scanGone.length) parts.push(`${scanGone.length} דפים שכבר לא נמצאו בסריקה`);
  return (
    <div className={`rounded-lg border border-violet-200 bg-violet-50 text-violet-900 ${compact ? "px-3 py-1.5 text-xs" : "px-3 py-2 text-sm"}`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Sparkles size={compact ? 13 : 15} className="text-violet-600 shrink-0" />
        <b>נתונים חדשים:</b> {parts.join(" · ") || "—"}
        {unacked > 0 && <span>· <b>{unacked}</b> מילות מפתח חדשות מסומנות בסגול בלשונית <Link to={`/clients/${cid}/structure`} className="underline">ביטויי יעד</Link></span>}
        {(newKws.length > 0 || scanNew.length > 0 || scanGone.length > 0 || newPagesFiles.length > 0) && (
          <button className="text-violet-700 hover:underline inline-flex items-center gap-0.5" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} פירוט
          </button>
        )}
      </div>
      {open && (
        <div className="mt-1.5 space-y-1 text-xs">
          {newKws.length > 0 && <div><b>מילות מפתח חדשות:</b> {newKws.slice(0, 200).join(", ")}{newKws.length > 200 ? ` ועוד ${newKws.length - 200}` : ""}</div>}
          {newPagesFiles.length > 0 && <div><b>דפים חדשים בקבצים:</b> {newPagesFiles.slice(0, 50).join(" · ")}</div>}
          {scanNew.length > 0 && <div><b>דפים חדשים בסריקה:</b> {scanNew.map((p) => p.title || p.url).join(" · ")}</div>}
          {scanGone.length > 0 && <div><b>לא נמצאו בסריקה האחרונה:</b> {scanGone.map((p) => p.title || p.url).join(" · ")}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * Banner at the top of a tab: which uploaded files this tab relies on (with how many keywords
 * each brought and the period it covers), the latest site scan, and what's new.
 * `match` filters datasets by source (substring, case-insensitive); omit to show all.
 * `onRefresh` lets the page run its own full refresh (and report what changed).
 */
export default function DataSourceBanner({ cid, match, onRefresh, refreshing }: { cid: number; match?: string[]; onRefresh?: () => void; refreshing?: boolean }) {
  const qc = useQueryClient();
  const [showFiles, setShowFiles] = useState(false);
  const { data: datasets, isFetching } = useQuery({ queryKey: ["datasets", cid], queryFn: () => api.listDatasets(cid), enabled: !!cid });
  const { data: scan } = useQuery({ queryKey: ["site-scan", cid], queryFn: () => api.getLatestSiteScan(cid), enabled: !!cid });
  const { data: fileKws } = useQuery({ queryKey: ["uploaded-kws", cid], queryFn: () => api.getUploadedKeywords(cid), enabled: !!cid });

  const rel = (datasets || []).filter((d) => !match || match.some((m) => (d.source || "").toLowerCase().includes(m.toLowerCase())));
  const latest: UploadedDataset | undefined = rel[0]; // listDatasets is newest-first
  const scanDone = scan && scan.status === "done";
  const refresh = () => {
    if (onRefresh) return onRefresh();
    for (const k of ["datasets", "site-scan", "uploaded-kws", "kw-seen"]) qc.invalidateQueries({ queryKey: [k, cid] });
  };

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs space-y-1.5">
      <div className="flex items-start gap-2">
        <Database size={14} className={`mt-0.5 shrink-0 ${latest ? "text-brand-600" : "text-slate-400"}`} />
        <div className="flex-1 min-w-0 text-slate-600">
          {latest ? (
            <>
              מבוסס גם על נתונים שהועלו: <span className="font-medium text-slate-800">{latest.source}</span>
              {latest.filename ? ` · ${latest.filename}` : ""}
              {latest.kw_count ? <> · <b className="text-slate-800">{latest.kw_count.toLocaleString()} מילות מפתח</b></> : ""}
              {periodText(latest) ? ` · תקופה: ${periodText(latest)}` : ""}
              {` · הועלה ${fmtDate(latest.created_at)}`}
              {rel.length > 1 && (
                <button className="mr-1 text-brand-600 hover:underline inline-flex items-center gap-0.5" onClick={() => setShowFiles((s) => !s)}>
                  · ועוד {rel.length - 1} קבצים {showFiles ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
              )}
              {(fileKws?.length || 0) > 0 && <span> · סה"כ <b className="text-slate-800">{fileKws!.length.toLocaleString()}</b> מילות מפתח שונות מכל הקבצים</span>}
            </>
          ) : (
            <span className="text-slate-500">לא הועלו קבצים רלוונטיים ללשונית זו.</span>
          )}
        </div>
        <button className="text-slate-500 hover:text-brand-600 inline-flex items-center gap-1 shrink-0" title="עדכן את הלשונית עם הנתונים האחרונים" onClick={refresh}>
          <RefreshCw size={13} className={isFetching || refreshing ? "animate-spin" : ""} /> עדכן
        </button>
        <Link to={`/clients/${cid}/upload`} className="text-brand-600 hover:underline inline-flex items-center gap-1 shrink-0"><Upload size={13} /> העלאת נתונים</Link>
      </div>
      {showFiles && (
        <ul className="mr-6 text-slate-600 space-y-0.5">
          {rel.map((d) => (
            <li key={d.id}>
              <span className="font-medium text-slate-800">{d.filename || "קובץ"}</span> · {d.data_type || d.source} · {d.row_count.toLocaleString()} שורות
              {d.kw_count ? <> · <b>{d.kw_count.toLocaleString()} מילות מפתח</b></> : ""}
              {periodText(d) ? ` · ${periodText(d)}` : ""} · הועלה {fmtDate(d.created_at)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 text-slate-600">
        <ScanSearch size={14} className={`shrink-0 ${scanDone ? "text-brand-600" : "text-amber-600"}`} />
        {scanDone ? (
          <span>סריקת דפי האתר: <b className="text-slate-800">{new Date(scan!.finished_at || scan!.started_at).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}</b> · <b className="text-slate-800">{scan!.pages_total}</b> דפים נסרקו ({scan!.pages_ok} עם טקסט תקין){scan!.new_pages?.length ? ` · ${scan!.new_pages.length} דפים חדשים מאז הסריקה הקודמת` : ""}</span>
        ) : scan?.status === "running" ? (
          <span>סריקת דפי האתר רצה עכשיו…</span>
        ) : (
          <span className="text-amber-700">דפי האתר עוד לא נסרקו. אפשר לסרוק בלשונית <Link to={`/clients/${cid}/upload`} className="underline">העלאת נתונים</Link>.</span>
        )}
      </div>
      <NewDataNotice cid={cid} compact />
    </div>
  );
}
