import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Pencil, Trash2, Save, X, Wand2, ExternalLink, Check, ListChecks } from "lucide-react";
import * as api from "../api";
import type { ReportItem } from "../api";

function ItemRow({ item, onChanged }: { item: ReportItem; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [why, setWhy] = useState(item.why || "");
  const [page, setPage] = useState(item.page_url || "");
  const [improveOpen, setImproveOpen] = useState(false);
  const [instr, setInstr] = useState("");
  const [draft, setDraft] = useState<{ title: string; why: string } | null>(null);

  const save = useMutation({ mutationFn: () => api.updateReportItem(item.id, { title, why, page_url: page || null }), onSuccess: () => { setEditing(false); onChanged(); } });
  const del = useMutation({ mutationFn: () => api.deleteReportItem(item.id), onSuccess: onChanged });
  const improve = useMutation({ mutationFn: () => api.improveReportItem(item.id, instr || undefined), onSuccess: (d) => setDraft(d) });
  const applyDraft = useMutation({ mutationFn: () => api.updateReportItem(item.id, { title: draft!.title, why: draft!.why }), onSuccess: () => { setDraft(null); setImproveOpen(false); setInstr(""); onChanged(); } });

  if (editing) {
    return (
      <li className="py-3 border-b border-slate-100 last:border-0 flex flex-col gap-2 no-print">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="כותרת השינוי" />
        <textarea className="input" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="למה בוצע ואיך זה תורם ללקוח" />
        <input className="input" value={page} onChange={(e) => setPage(e.target.value)} placeholder="קישור לעמוד (אופציונלי)" />
        <div className="flex gap-1.5">
          <button className="btn-primary text-sm py-1.5" onClick={() => save.mutate()} disabled={save.isPending}><Save size={15} /> שמור</button>
          <button className="btn-secondary text-sm py-1.5" onClick={() => setEditing(false)}><X size={15} /> ביטול</button>
        </div>
      </li>
    );
  }

  return (
    <li className="py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-900">{item.title}</div>
          {item.why && <div className="text-sm text-slate-600 mt-0.5 whitespace-pre-wrap">{item.why}</div>}
          {item.page_url && <a href={item.page_url} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-0.5 mt-1 break-all"><ExternalLink size={11} /> {item.page_url.replace(/^https?:\/\/[^/]+/, "") || item.page_url}</a>}
        </div>
        <div className="shrink-0 flex items-center gap-1 no-print">
          <button className="text-slate-400 hover:text-brand-600 p-1" title="שפר הסבר ב-AI" onClick={() => setImproveOpen((o) => !o)}><Wand2 size={15} /></button>
          <button className="text-slate-400 hover:text-brand-600 p-1" title="ערוך" onClick={() => { setTitle(item.title); setWhy(item.why || ""); setPage(item.page_url || ""); setEditing(true); }}><Pencil size={15} /></button>
          <button className="text-slate-400 hover:text-rose-600 p-1" title="מחק" onClick={() => { if (confirm("למחוק את הפריט מהדוח?")) del.mutate(); }}><Trash2 size={15} /></button>
        </div>
      </div>

      {improveOpen && (
        <div className="no-print mt-2 bg-slate-50 rounded-lg p-3">
          <div className="text-xs text-slate-500 mb-1">הנחיה לשיפור (אופציונלי) — למשל "קצר יותר", "הדגש את התועלת העסקית", "טון רשמי":</div>
          <div className="flex gap-2">
            <input className="input flex-1 text-sm" value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="הנחיה (אופציונלי)" />
            <button className="btn-primary text-sm py-1.5 shrink-0" onClick={() => improve.mutate()} disabled={improve.isPending}>
              {improve.isPending ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} צור טיוטה
            </button>
          </div>
          {improve.isError && <div className="text-xs text-rose-600 mt-1">{(improve.error as any)?.message}</div>}
          {draft && (
            <div className="mt-2 bg-white border border-brand-200 rounded-lg p-2 text-sm">
              <div className="font-semibold text-slate-900">{draft.title}</div>
              <div className="text-slate-600 mt-0.5 whitespace-pre-wrap">{draft.why}</div>
              <div className="flex gap-1.5 mt-2">
                <button className="btn-primary text-xs py-1 px-2" onClick={() => applyDraft.mutate()} disabled={applyDraft.isPending}><Check size={13} /> החל טיוטה</button>
                <button className="text-xs py-1 px-2 rounded text-slate-500 hover:bg-slate-100" onClick={() => setDraft(null)}>בטל</button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function ReportItems({ reportId, clientId }: { reportId: number; clientId: number }) {
  const qc = useQueryClient();
  const { data: items } = useQuery({ queryKey: ["report-items", reportId], queryFn: () => api.listReportItems(reportId), enabled: !!reportId });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["report-items", reportId] });

  const sync = useMutation({ mutationFn: () => api.syncReportItems(reportId), onSuccess: invalidate });

  const [adding, setAdding] = useState(false);
  const [t, setT] = useState(""); const [w, setW] = useState(""); const [p, setP] = useState("");
  const add = useMutation({
    mutationFn: () => api.createReportItem(reportId, clientId, { title: t.trim(), why: w.trim() || null, page_url: p.trim() || null }),
    onSuccess: () => { setT(""); setW(""); setP(""); setAdding(false); invalidate(); },
  });

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-lg font-bold text-slate-900 border-r-4 border-brand-500 pr-2">
          פעולות שבוצעו <span className="text-slate-400 text-sm font-normal">({(items || []).length})</span>
        </h2>
        <div className="flex gap-1.5 no-print">
          <button className="btn-secondary text-sm py-1.5" onClick={() => setAdding((a) => !a)}><Plus size={15} /> הוסף ידנית</button>
          <button className="btn-primary text-sm py-1.5" onClick={() => sync.mutate()} disabled={sync.isPending} title="משוך את כל הפעולות שבוצעו במערכת לדוח">
            {sync.isPending ? <Loader2 size={15} className="animate-spin" /> : <ListChecks size={15} />} הוסף פעולות שבוצעו
          </button>
        </div>
      </div>

      {sync.isSuccess && <div className="no-print text-sm text-emerald-600 mb-2">נוספו {(sync.data as any).added} פעולות{(sync.data as any).note ? ` — ${(sync.data as any).note}` : ""}.</div>}
      {sync.isError && <div className="no-print text-sm text-rose-600 mb-2">{(sync.error as any)?.message}</div>}

      {adding && (
        <div className="no-print card mb-3 border-brand-200">
          <div className="flex flex-col gap-2">
            <input className="input" value={t} onChange={(e) => setT(e.target.value)} placeholder="כותרת השינוי" />
            <textarea className="input" rows={2} value={w} onChange={(e) => setW(e.target.value)} placeholder="למה בוצע ואיך זה תורם ללקוח" />
            <input className="input" value={p} onChange={(e) => setP(e.target.value)} placeholder="קישור לעמוד (אופציונלי)" />
            <div className="flex gap-1.5">
              <button className="btn-primary text-sm py-1.5" onClick={() => add.mutate()} disabled={add.isPending || !t.trim()}><Save size={15} /> הוסף</button>
              <button className="btn-secondary text-sm py-1.5" onClick={() => setAdding(false)}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {(items || []).length === 0 ? (
        <p className="text-slate-400 text-sm">אין עדיין פעולות. לחץ "הוסף פעולות שבוצעו" כדי למשוך אוטומטית את כל מה שבוצע, או הוסף ידנית.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {(items || []).map((it) => <ItemRow key={it.id} item={it} onChanged={invalidate} />)}
        </ul>
      )}
    </section>
  );
}
