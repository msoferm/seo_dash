import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2, Loader2, ArrowLeft, Sparkles, ListChecks, Image as ImageIcon, ClipboardCheck, ExternalLink, ChevronDown, ChevronUp, Check } from "lucide-react";
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
  const { data: activity } = useQuery({ queryKey: ["activity", cid], queryFn: () => api.getActivityLog(cid), enabled: !!cid });
  const [actOpen, setActOpen] = useState(true);
  const catForArea = (area: string): string =>
    /קישור/.test(area) ? "קישורים"
      : /טכני|מהירות|אודיט/.test(area) ? "אופטימיזציה טכנית ותיקונים"
      : /המרו|UX/.test(area) ? "המרות ו-UX"
      : /תוכן|מילות|ביצועים/.test(area) ? "תוכן באתר"
      : "אחר";
  const actGroups = (() => {
    const order = ["קישורים", "תוכן באתר", "אופטימיזציה טכנית ותיקונים", "המרות ו-UX", "אחר"];
    const m = new Map<string, typeof activity>();
    for (const e of activity || []) { const c = catForArea(e.area); if (!m.has(c)) m.set(c, [] as any); (m.get(c) as any).push(e); }
    return [...m.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));
  })();

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

  const addToLatest = useMutation({
    mutationFn: () => api.addToLatestReport(cid),
    onSuccess: (res) => {
      if (!res) { alert("אין עדיין דוח. צור דוח חדש ואז הוסף אליו את הפעולות."); return; }
      qc.invalidateQueries({ queryKey: ["report-items", res.report_id] });
      navigate(`/clients/${cid}/reports/${res.report_id}`);
    },
  });

  // Latest report + its items — to show which actions are already in the report (green ✓)
  // and to add a single action to it (#2b).
  const latestReport = (reports || [])[0];
  const { data: latestItems } = useQuery({ queryKey: ["report-items", latestReport?.id], queryFn: () => api.listReportItems(latestReport!.id), enabled: !!latestReport });
  const inReport = new Set((latestItems || []).filter((it) => it.source_ref).map((it) => `${it.source_type}:${it.source_ref}`));
  const addOne = useMutation({
    mutationFn: (e: api.ActivityEntry) => api.addActivityToReport(latestReport!.id, cid, e),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["report-items", latestReport?.id] }),
  });

  // Month filter for the saved-reports list (#2a).
  const [monthFilter, setMonthFilter] = useState("");
  const monthKey = (r: Report) => r.period_to.slice(0, 7);
  const months = [...new Set((reports || []).map(monthKey))].sort().reverse();
  const shownReports = monthFilter ? (reports || []).filter((r) => monthKey(r) === monthFilter) : (reports || []);
  const monthName = (m: string) => { const d = new Date(m + "-01T00:00:00"); return `${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

  // Branding (logo + color)
  const { data: branding } = useQuery({ queryKey: ["branding", cid], queryFn: () => api.getBranding(cid), enabled: !!cid });
  const saveBrand = useMutation({ mutationFn: (b: { logo_url?: string | null; brand_color?: string | null }) => api.saveBranding(cid, b), onSuccess: () => qc.invalidateQueries({ queryKey: ["branding", cid] }) });
  async function handleLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const dataUrl = await new Promise<string>((res, rej) => {
      const img = new Image();
      const r = new FileReader();
      r.onload = () => { img.onload = () => {
        const max = 360; const scale = Math.min(1, max / img.width);
        const c = document.createElement("canvas"); c.width = img.width * scale; c.height = img.height * scale;
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/png"));
      }; img.onerror = rej; img.src = r.result as string; };
      r.onerror = rej; r.readAsDataURL(file);
    });
    saveBrand.mutate({ logo_url: dataUrl });
  }

  return (
    <div>
      <PageHeader
        title="דוחות קידום"
        subtitle={client ? `${client.name} · דוחות חודשיים ללקוח` : "דוחות חודשיים ללקוח"}
        actions={
          <>
            <button className="btn-secondary" onClick={() => addToLatest.mutate()} disabled={addToLatest.isPending} title="מושך את כל הפעולות שבוצעו במערכת אל הדוח האחרון">
              {addToLatest.isPending ? <Loader2 size={18} className="animate-spin" /> : <ListChecks size={18} />} הוסף לדוח האחרון
            </button>
            <button className="btn-primary" onClick={() => setCreating((c) => !c)}>
              <Plus size={18} /> דוח חדש
            </button>
          </>
        }
      />

      {/* Branding (logo + color) — at the top */}
      <div className="card mb-6">
        <h3 className="font-semibold flex items-center gap-2 text-slate-800 mb-3"><ImageIcon size={18} className="text-brand-600" /> מיתוג הדוח (לוגו + צבע)</h3>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            {branding?.logo_url ? <img src={branding.logo_url} alt="logo" className="h-12 border border-slate-200 rounded p-1 bg-white" /> : <div className="h-12 w-20 bg-slate-100 rounded flex items-center justify-center text-slate-400 text-xs">אין לוגו</div>}
            <label className="btn-secondary text-sm py-1.5 cursor-pointer">העלה לוגו<input type="file" accept="image/*" className="hidden" onChange={handleLogo} /></label>
            {branding?.logo_url && <button className="text-xs text-rose-600 hover:underline" onClick={() => saveBrand.mutate({ logo_url: null })}>הסר</button>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">צבע מותג:</span>
            <input type="color" className="h-9 w-12 rounded border border-slate-200 cursor-pointer" value={branding?.brand_color || "#1d4ed8"} onChange={(e) => saveBrand.mutate({ brand_color: e.target.value })} />
            {branding?.brand_color && <button className="text-xs text-slate-500 hover:underline" onClick={() => saveBrand.mutate({ brand_color: null })}>ברירת מחדל</button>}
          </div>
          {saveBrand.isPending && <Loader2 size={16} className="animate-spin text-slate-400" />}
        </div>
        <p className="text-xs text-slate-400 mt-2">הלוגו והצבע יופיעו בכותרת הדוח ובהדפסה/PDF.</p>
      </div>

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

      {/* Completed actions preview (before/independent of a report) */}
      <div className="card mb-6">
        <button className="w-full flex items-center justify-between gap-2 text-right" onClick={() => setActOpen((o) => !o)}>
          <h3 className="font-semibold flex items-center gap-2 text-slate-800"><ClipboardCheck size={18} className="text-brand-600" /> פעולות שבוצעו <span className="text-xs font-normal text-slate-400">({(activity || []).length}) — סקירה לפני יצירת דוח</span></h3>
          {actOpen ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
        </button>
        {actOpen && (
          (activity || []).length === 0 ? (
            <p className="text-slate-400 text-sm mt-2">עדיין לא בוצעו פעולות. ברגע שתסמן "בוצע" או "בצע" במערכת — הן יופיעו כאן אוטומטית.</p>
          ) : (
            <div className="space-y-4 mt-3">
              {actGroups.map(([c, items]) => (
                <div key={c}>
                  <h4 className="text-sm font-bold text-blue-700 bg-blue-50 rounded-md px-3 py-1.5 mb-1 border-r-4 border-blue-400">{c} <span className="font-normal text-blue-400">({(items as any).length})</span></h4>
                  <ul className="divide-y divide-slate-100">
                    {(items as any).map((e: any) => {
                      const key = `${e.kind}:${(e.id as string).split(":")[1]}`;
                      const added = inReport.has(key);
                      return (
                      <li key={e.id} className="py-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 text-sm">{e.title}</div>
                          <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            {e.date && <span className="text-xs text-slate-400">{new Date(e.date).toLocaleDateString("he-IL")}</span>}
                            {e.page && <a href={e.page} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-0.5"><ExternalLink size={11} /> למעבר לדף</a>}
                          </div>
                        </div>
                        {added
                          ? <span className="text-xs text-emerald-600 inline-flex items-center gap-1 shrink-0 no-print"><Check size={13} /> בדוח</span>
                          : <button className="btn-secondary text-xs py-1 px-2 shrink-0 no-print" disabled={!latestReport || (addOne.isPending && (addOne.variables as any)?.id === e.id)}
                              title={latestReport ? "הוסף פעולה זו לדוח האחרון" : "אין דוח — צור דוח קודם"} onClick={() => addOne.mutate(e)}>
                              {addOne.isPending && (addOne.variables as any)?.id === e.id ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} הוסף לדוח
                            </button>}
                      </li>
                    ); })}
                  </ul>
                </div>
              ))}
              <p className="text-xs text-slate-400">הפעולות נכנסות אוטומטית לדוח האחרון. לעריכה/איחוד/שיפור הסבר — פתח את הדוח.</p>
            </div>
          )
        )}
      </div>

      {/* Saved reports */}
      <div className="card mb-6">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h3 className="font-semibold flex items-center gap-2 text-slate-800">
            <FileText size={18} /> דוחות שמורים
          </h3>
          {months.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">חודש:</span>
              <select className="input py-1 text-sm w-auto" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                <option value="">כל החודשים</option>
                {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
              </select>
            </div>
          )}
        </div>
        {isLoading ? (
          <Spinner />
        ) : (reports || []).length === 0 ? (
          <p className="text-slate-500 text-sm py-2">אין עדיין דוחות. צור דוח חדש כדי להתחיל.</p>
        ) : shownReports.length === 0 ? (
          <p className="text-slate-500 text-sm py-2">אין דוחות בחודש שנבחר.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shownReports.map((r) => (
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
