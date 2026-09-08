import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2, FileSpreadsheet, Trash2, Check } from "lucide-react";
import * as api from "../api";
import type { UploadedDataset } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

export default function DataUploadPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: datasets, isLoading } = useQuery({ queryKey: ["datasets", cid], queryFn: () => api.listDatasets(cid), enabled: !!cid });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["datasets", cid] });

  const upload = useMutation({
    mutationFn: (f: { name: string; text: string }) => api.uploadData(cid, f.name, f.text),
    onSuccess: () => { if (fileRef.current) fileRef.current.value = ""; invalidate(); },
  });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteDataset(id), onSuccess: invalidate });

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    upload.mutate({ name: file.name, text });
  }

  const mappedFields = (m: Record<string, string> | null) => m ? Object.entries(m).filter(([, v]) => v && v !== "null").map(([k]) => k) : [];

  return (
    <div>
      <PageHeader title="העלאת נתונים" subtitle={client ? `${client.name} · העלה קבצים מכלים נוספים — זיהוי אוטומטי` : "העלאת נתונים"} />

      <div className="card mb-6">
        <p className="text-sm text-slate-600 mb-3">העלה קובץ CSV/TSV מכל כלי (GA4, ZEFO, Keyword Planner, Search Console ועוד). המערכת תזהה לבד את המקור, העמודות וטווח התאריכים, ותשמור את הנתונים מנורמלים.</p>
        <label className="btn-primary cursor-pointer inline-flex">
          {upload.isPending ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />} {upload.isPending ? "מזהה ומעלה..." : "בחר קובץ להעלאה"}
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleFile} disabled={upload.isPending} />
        </label>
        {upload.isError && <div className="mt-3 text-sm text-rose-600">{(upload.error as any)?.message}</div>}
        {upload.isSuccess && upload.data && (
          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
            <div className="flex items-center gap-2 font-medium"><Check size={16} /> זוהה: {upload.data.source} · {upload.data.data_type}</div>
            <div className="text-xs text-emerald-700 mt-1">{upload.data.row_count} שורות · עמודות שזוהו: {mappedFields(upload.data.columns).join(", ") || "—"}{upload.data.date_from ? ` · תקופה: ${upload.data.date_from} – ${upload.data.date_to}` : ""}</div>
          </div>
        )}
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
