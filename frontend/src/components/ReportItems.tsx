import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Pencil, Trash2, Save, X, Wand2, ExternalLink, Check, GripVertical, Heading, Type, TextCursorInput } from "lucide-react";
import * as api from "../api";
import type { ReportItem } from "../api";

const TEXT_SIZE_CLASS: Record<string, string> = { sm: "text-sm", base: "text-base", lg: "text-lg", xl: "text-xl font-semibold" };
const SIZE_OPTS: [string, string][] = [["sm", "קטן"], ["base", "רגיל"], ["lg", "גדול"], ["xl", "כותרת משנה"]];

function DragHandle({ onDragStart }: { onDragStart: () => void }) {
  return (
    <span draggable onDragStart={onDragStart} className="no-print cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 pt-1 shrink-0 self-start" title="גרור לסידור">
      <GripVertical size={15} />
    </span>
  );
}

// ---- Heading block (blue "action" heading or neutral "general" section title) ----
function HeadingBlock({ item, onChanged }: { item: ReportItem; onChanged: () => void }) {
  const [val, setVal] = useState(item.title);
  const save = useMutation({ mutationFn: () => api.updateReportItem(item.id, { title: val.trim() }), onSuccess: onChanged });
  const del = useMutation({ mutationFn: () => api.deleteReportItem(item.id), onSuccess: onChanged });
  const isAction = item.heading_kind !== "general";
  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => { if (val.trim() !== item.title) save.mutate(); }}
        placeholder={isAction ? "כותרת לפעולות שבוצעו" : "כותרת כללית (למשל: סיכום פעילות)"}
        className={isAction
          ? "flex-1 min-w-0 bg-blue-50 text-blue-700 font-bold rounded-md px-3 py-1.5 border-r-4 border-blue-400 outline-none focus:ring-2 focus:ring-blue-200"
          : "flex-1 min-w-0 bg-transparent text-slate-900 text-lg font-bold border-r-4 border-brand-500 pr-2 outline-none focus:bg-slate-50 rounded"}
      />
      <button className="no-print text-slate-400 hover:text-rose-600 p-1 shrink-0" title="מחק כותרת" onClick={() => { if (confirm("למחוק את הכותרת?")) del.mutate(); }}><Trash2 size={15} /></button>
    </div>
  );
}

// ---- Free-text block with size control ----
function TextBlock({ item, onChanged }: { item: ReportItem; onChanged: () => void }) {
  const [val, setVal] = useState(item.why || "");
  const size = item.text_size || "base";
  const saveText = useMutation({ mutationFn: () => api.updateReportItem(item.id, { why: val }), onSuccess: onChanged });
  const saveSize = useMutation({ mutationFn: (s: string) => api.updateReportItem(item.id, { text_size: s }), onSuccess: onChanged });
  const del = useMutation({ mutationFn: () => api.deleteReportItem(item.id), onSuccess: onChanged });
  return (
    <div className="flex-1 min-w-0">
      <div className="no-print flex items-center gap-2 mb-1">
        <span className="text-xs text-slate-400 inline-flex items-center gap-1"><Type size={12} /> גודל:</span>
        <select className="input py-0.5 text-xs w-auto" value={size} onChange={(e) => saveSize.mutate(e.target.value)}>
          {SIZE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="text-slate-400 hover:text-rose-600 p-1 ml-auto" title="מחק תיבה" onClick={() => { if (confirm("למחוק את תיבת הטקסט?")) del.mutate(); }}><Trash2 size={15} /></button>
      </div>
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => { if (val !== (item.why || "")) saveText.mutate(); }}
        placeholder="כתוב כאן טקסט חופשי שיופיע בדוח..."
        rows={Math.max(2, val.split("\n").length)}
        className={`w-full bg-transparent outline-none focus:bg-slate-50 rounded px-2 py-1 text-slate-700 whitespace-pre-wrap resize-y ${TEXT_SIZE_CLASS[size] || "text-base"}`}
      />
    </div>
  );
}

// ---- Action item (completed action: title + explanation + page) ----
function ActionBlock({ item, onChanged }: { item: ReportItem; onChanged: () => void }) {
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
      <div className="flex-1 min-w-0 flex flex-col gap-2 no-print">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="כותרת השינוי" />
        <textarea className="input" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="למה בוצע ואיך זה תורם ללקוח" />
        <input className="input" value={page} onChange={(e) => setPage(e.target.value)} placeholder="קישור לעמוד (אופציונלי)" />
        <div className="flex gap-1.5">
          <button className="btn-primary text-sm py-1.5" onClick={() => save.mutate()} disabled={save.isPending}><Save size={15} /> שמור</button>
          <button className="btn-secondary text-sm py-1.5" onClick={() => setEditing(false)}><X size={15} /> ביטול</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-900">{item.title}</div>
          {item.why && <div className="text-sm text-slate-600 mt-0.5 whitespace-pre-wrap">{item.why}</div>}
          {item.page_url && <a href={item.page_url} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-0.5 mt-1"><ExternalLink size={11} /> למעבר לדף</a>}
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
    </div>
  );
}

export default function ReportItems({ reportId, clientId }: { reportId: number; clientId: number }) {
  const qc = useQueryClient();
  const { data: items } = useQuery({ queryKey: ["report-items", reportId], queryFn: () => api.listReportItems(reportId), enabled: !!reportId });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["report-items", reportId] });
  const blocks = items || [];

  const addHeading = useMutation({ mutationFn: (kind: "action" | "general") => api.createReportBlock(reportId, clientId, { block_type: "heading", title: "", heading_kind: kind }), onSuccess: invalidate });
  const addText = useMutation({ mutationFn: () => api.createReportBlock(reportId, clientId, { block_type: "text", why: "", text_size: "base" }), onSuccess: invalidate });

  const [adding, setAdding] = useState(false);
  const [t, setT] = useState(""); const [w, setW] = useState(""); const [p, setP] = useState("");
  const add = useMutation({
    mutationFn: () => api.createReportItem(reportId, clientId, { title: t.trim(), why: w.trim() || null, page_url: p.trim() || null }),
    onSuccess: () => { setT(""); setW(""); setP(""); setAdding(false); invalidate(); },
  });

  // Drag-reorder
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const reorder = useMutation({ mutationFn: (ids: number[]) => api.reorderReportItems(ids), onSuccess: invalidate });
  const doReorder = (from: number, to: number) => {
    if (from === to || from == null || to == null) return;
    const arr = [...blocks]; const [m] = arr.splice(from, 1); arr.splice(to, 0, m);
    qc.setQueryData(["report-items", reportId], arr); // optimistic
    reorder.mutate(arr.map((b) => b.id));
  };

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-lg font-bold text-slate-900 border-r-4 border-brand-500 pr-2">
          פעולות שבוצעו ותוכן הדוח <span className="text-slate-400 text-sm font-normal">({blocks.length})</span>
        </h2>
      </div>

      <div className="no-print flex flex-wrap gap-1.5 mb-3">
        <button className="btn-secondary text-sm py-1.5" onClick={() => addHeading.mutate("action")} disabled={addHeading.isPending}><Heading size={15} className="text-blue-600" /> כותרת לפעולות שבוצעו</button>
        <button className="btn-secondary text-sm py-1.5" onClick={() => addHeading.mutate("general")} disabled={addHeading.isPending}><Heading size={15} /> כותרת כללית</button>
        <button className="btn-secondary text-sm py-1.5" onClick={() => addText.mutate()} disabled={addText.isPending}><TextCursorInput size={15} /> תיבת טקסט</button>
        <button className="btn-secondary text-sm py-1.5" onClick={() => setAdding((a) => !a)}><Plus size={15} /> פעולה ידנית</button>
      </div>

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

      {blocks.length === 0 ? (
        <p className="text-slate-400 text-sm">אין עדיין תוכן. הוסף כותרות, תיבות טקסט או פעולות — וגרור לסידור. פעולות שבוצעו נמשכות גם דרך "הוסף לדוח" במסך הדוחות.</p>
      ) : (
        <ul>
          {blocks.map((it, i) => (
            <li
              key={it.id}
              onDragOver={(e) => { e.preventDefault(); if (overIdx !== i) setOverIdx(i); }}
              onDrop={(e) => { e.preventDefault(); if (dragIdx !== null) doReorder(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
              className={`flex items-start gap-1.5 py-2 border-b border-slate-100 last:border-0 ${dragIdx === i ? "opacity-40" : ""} ${overIdx === i && dragIdx !== null && dragIdx !== i ? "border-t-2 border-t-brand-400" : ""}`}
            >
              <DragHandle onDragStart={() => setDragIdx(i)} />
              {it.block_type === "heading" ? <HeadingBlock item={it} onChanged={invalidate} />
                : it.block_type === "text" ? <TextBlock item={it} onChanged={invalidate} />
                : <ActionBlock item={it} onChanged={invalidate} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
