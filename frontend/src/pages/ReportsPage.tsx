import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2, Loader2, ArrowLeft, Sparkles } from "lucide-react";
import * as api from "../api";
import type { Report } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import ReportLinksManager from "../components/ReportLinksManager";

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** First and last day of the previous full month. */
function lastFullMonth(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: fmt(first), to: fmt(last) };
}

const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

export function reportLabel(r: Pick<Report, "period_from" | "period_to" | "title">): string {
  if (r.title) return r.title;
  const f = new Date(r.period_from);
  const t = new Date(r.period_to);
  if (f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) {
    return `${HE_MONTHS[f.getMonth()]} ${f.getFullYear()}`;
  }
  return `${r.period_from} – ${r.period_to}`;
}

export default function ReportsPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const initial = lastFullMonth();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [creating, setCreating] = useState(false);

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: reports, isLoading } = useQuery({
    queryKey: ["reports", cid],
    queryFn: () => api.listReports(cid),
    enabled: !!cid,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["reports", cid] });

  const create = useMutation({
    mutationFn: async () => {
      // Pull fresh, accurate GSC + GA4 data for exactly this period first, so both the
      // narrative and the report view reflect real current numbers (not a stale window).
      await api.syncReportPeriod(cid, from, to);
      // Draft narrative with Claude (best-effort — a failure still creates an empty report).
      let summary = "";
      let recommendations = "";
      try {
        const draft = await api.generateReportNarrative(cid, from, to);
        summary = draft.summary;
        recommendations = draft.recommendations;
      } catch {
        /* leave blank — editable in the report */
      }
      return api.createReport({
        client_id: cid,
        period_from: from,
        period_to: to,
        summary_text: summary,
        recommendations_text: recommendations,
      });
    },
    onSuccess: (report) => {
      invalidate();
      setCreating(false);
      navigate(`/clients/${cid}/reports/${report.id}`);
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteReport(id),
    onSuccess: invalidate,
  });

  return (
    <div>
      <PageHeader
        title="דוחות קידום"
        subtitle={client ? `${client.name} · דוחות חודשיים ללקוח` : "דוחות חודשיים ללקוח"}
        actions={
          <button className="btn-primary" onClick={() => setCreating((c) => !c)}>
            <Plus size={18} /> דוח חדש
          </button>
        }
      />

      {/* New report composer */}
      {creating && (
        <div className="card mb-6 border-brand-200">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-slate-800">
            <Sparkles size={18} className="text-brand-600" /> יצירת דוח חדש
          </h3>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">מתאריך</label>
              <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">עד תאריך</label>
              <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </div>
            <button className="btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              {create.isPending ? "מסנכרן נתונים וכותב דוח..." : "צור דוח (קלוד מנסח)"}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2">ברירת המחדל: החודש המלא האחרון. קלוד ינסח טיוטת סיכום והמלצות שתוכל לערוך בדוח עצמו.</p>
          {create.isError && <div className="text-sm text-rose-600 mt-2">שגיאה: {(create.error as any)?.message}</div>}
        </div>
      )}

      {/* Saved reports */}
      <div className="card mb-6">
        <h3 className="font-semibold mb-3 flex items-center gap-2 text-slate-800">
          <FileText size={18} /> דוחות שמורים
        </h3>
        {isLoading ? (
          <Spinner />
        ) : (reports || []).length === 0 ? (
          <p className="text-slate-500 text-sm py-2">אין עדיין דוחות. צור דוח חדש כדי להתחיל.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(reports || []).map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-3">
                <FileText size={18} className="text-slate-400 shrink-0" />
                <button
                  className="flex-1 min-w-0 text-right hover:text-brand-700"
                  onClick={() => navigate(`/clients/${cid}/reports/${r.id}`)}
                >
                  <span className="font-medium">{reportLabel(r)}</span>
                  <span className="text-xs text-slate-400 mr-2">
                    {r.period_from} – {r.period_to}
                  </span>
                </button>
                <button
                  className="btn-secondary text-sm py-1.5"
                  onClick={() => navigate(`/clients/${cid}/reports/${r.id}`)}
                >
                  פתח <ArrowLeft size={15} />
                </button>
                <button
                  className="text-slate-400 hover:text-rose-600 shrink-0 p-1"
                  title="מחק"
                  onClick={() => { if (confirm("למחוק את הדוח?")) remove.mutate(r.id); }}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Manual links bank */}
      <ReportLinksManager clientId={cid} />
    </div>
  );
}
