import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Md } from "./StructureChat";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Loader2, ChevronDown, ChevronUp, Check, PencilLine, StickyNote, Eye, EyeOff, ExternalLink, CheckCircle2 } from "lucide-react";
import * as api from "../api";
import type { StructureAction, StructureDecision, StructureRec } from "../api";
import { decisionColor, SELECTED_COLOR, REC_TYPE_LABEL } from "../lib/decisionColors";

function decodePath(u: string): string {
  try { return decodeURIComponent(u.replace(/^https?:\/\/[^/]+/, "")) || u; } catch { return u; }
}
const PRI: Record<string, string> = { high: "עדיפות גבוהה", medium: "עדיפות בינונית", low: "עדיפות נמוכה" };
const TYPE_ORDER = ["site_strategy", "same_intent", "cannibalization", "relocate", "unassigned", "new_page"] as const;

export type Selection = { key: string; keywords: string[] } | null;

/** The "ניתוח AI כולל" panel: run the combined analysis, review each recommendation with its
 *  keywords/pages shown together, accept it (fully / partially / with a note). Accepted decisions are listed in the user-intent tab. */
export default function StructureAiPlan({ cid, from, to, decisions, selection, onSelect, renderCards, pageOptions, kwLines }: {
  cid: number; from: string; to: string;
  decisions: StructureDecision[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  renderCards: (keywords: string[]) => ReactNode;
  pageOptions: { url: string; label: string }[];
  kwLines: (keywords: string[]) => string[];
}) {
  const qc = useQueryClient();
  const { data: analysis } = useQuery({ queryKey: ["structure-analysis", cid], queryFn: () => api.getStructureAnalysis(cid), enabled: !!cid });
  // Step 2: a detailed user-intent analysis per recommendation (3 at a time), saved with the recs.
  const [intentProg, setIntentProg] = useState<{ done: number; total: number } | null>(null);
  const fillIntents = async (all: StructureRec[]) => {
    const todo = all.filter((r) => !r.intent_analysis && r.keywords.length > 0);
    if (!todo.length) return;
    const out = new Map<string, string>();
    setIntentProg({ done: 0, total: todo.length });
    let next = 0, done = 0;
    const worker = async () => {
      while (next < todo.length) {
        const r = todo[next++];
        try { out.set(r.key, (await api.structureRecIntent(cid, r, kwLines(r.keywords))).intent_analysis); } catch { /* left empty — can be retried */ }
        setIntentProg({ done: ++done, total: todo.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const merged = all.map((r) => out.has(r.key) ? { ...r, intent_analysis: out.get(r.key) } : r);
    await api.saveStructureRecs(cid, merged);
    setIntentProg(null);
    qc.invalidateQueries({ queryKey: ["structure-analysis", cid] });
  };
  const run = useMutation({
    mutationFn: () => api.runStructureAnalysis(cid, from, to),
    onSuccess: async (r) => { await qc.invalidateQueries({ queryKey: ["structure-analysis", cid] }); await fillIntents(r.recs || []); },
  });
  const missingIntent = (analysis?.recs || []).filter((r) => !r.intent_analysis && r.keywords.length > 0).length;
  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["structure-decisions", cid] });
    qc.invalidateQueries({ queryKey: ["kw-targets", cid] });
  };
  const [listOpen, setListOpen] = useState(true);

  const acceptedKeys = new Set(decisions.map((d) => d.rec_key));
  const recs = (analysis?.recs || []).filter((r) => !acceptedKeys.has(r.key));
  const nextColor = decisions.length ? Math.max(...decisions.map((d) => d.color)) + 1 : 0;


  const toggleSel = (key: string, keywords: string[]) => onSelect(selection?.key === key ? null : { key, keywords });

  return (
    <div className="card mb-4 border-r-4 border-r-amber-400">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button className="font-semibold flex items-center gap-2 text-slate-800" onClick={() => setListOpen((o) => !o)}>
          <Sparkles size={18} className="text-amber-500" /> ניתוח AI כולל: המלצות למבנה האתר
          {listOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        <div className="flex items-center gap-2">
          {analysis?.created_at && <span className="text-xs text-slate-400">ניתוח אחרון: {new Date(analysis.created_at).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}</span>}
          <button className="btn-primary text-sm" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {analysis ? "נתח מחדש" : "ניתוח AI כולל"}
          </button>
        </div>
      </div>
      {listOpen && (
        <>
          <p className="text-xs text-slate-500 mt-1">
            ה-AI מנתח יחד את כל מילות המפתח, העמודים המדורגים, הקניבליזציה, החלטות היעד וניתוחי כוונת המשתמש, וממליץ: אילו מילים לאחד לעמוד אחד, איך לפתור קניבליזציה, לאיזה עמוד לשייך מילים שעוד לא שויכו, ואילו מילים דורשות עמוד חדש.
            החלטות שכבר אישרת נשמרות, וניתוח חוזר לא ממליץ עליהן שוב.
          </p>
          {run.isPending && <div className="mt-3 text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> שלב 1: מנתח את כל הנתונים… (כ-2 דקות)</div>}
          {intentProg && <div className="mt-3 text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> שלב 2: כותב כוונת משתמש מפורטת לכל המלצה… {intentProg.done}/{intentProg.total}</div>}
          {!run.isPending && !intentProg && missingIntent > 0 && (
            <button className="mt-3 btn-secondary text-xs" onClick={() => fillIntents(analysis?.recs || [])}><Sparkles size={13} /> השלם כוונת משתמש ל-{missingIntent} המלצות</button>
          )}
          {run.isError && <div className="mt-3 text-sm text-rose-600">שגיאה: {(run.error as Error).message}</div>}

          {/* Accepted decisions live in the user-intent tab; here a summary + link (colors stay in the table) */}
          {decisions.length > 0 && (
            <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
              <span className="text-emerald-800 inline-flex items-center gap-1.5"><CheckCircle2 size={15} /> {decisions.length} החלטות אושרו. הן צבועות בטבלה למטה, והרשימה המלאה עם ההסברים וכפתור הביטול נמצאת בלשונית כוונת המשתמש.</span>
              <Link to={`/clients/${cid}/user-intent`} className="text-xs text-emerald-700 font-medium hover:underline">לרשימת ההחלטות ←</Link>
            </div>
          )}

          {/* Open recommendations, by category */}
          {analysis && recs.length === 0 && !run.isPending && (
            (analysis.recs || []).length > 0
              ? <p className="text-sm text-slate-400 mt-4">כל ההמלצות מהניתוח האחרון כבר אושרו. אפשר להריץ ניתוח מחדש.</p>
              : (
                <div className="mt-4 text-sm bg-rose-50 border border-rose-200 rounded-lg p-3 text-rose-800 space-y-1">
                  <div className="font-medium">הניתוח האחרון לא החזיר המלצות.</div>
                  {(analysis.debug?.diag || []).map((d) => (
                    <div key={d.part} className="text-xs">
                      {REC_TYPE_LABEL[d.part] || d.part}: {d.error ? `נכשל: ${d.error}` : `${d.parsed ?? 0} המלצות${d.stop === "max_tokens" ? " (התשובה נקטעה)" : ""}`}
                    </div>
                  ))}
                  {!!analysis.debug?.dropped && <div className="text-xs">{analysis.debug.dropped} המלצות נפסלו כי מילות המפתח בהן לא נמצאו בנתונים.</div>}
                  <div className="text-xs text-rose-600">נסה להריץ שוב. אם זה חוזר, העבר לי את ההודעה הזו.</div>
                </div>
              )
          )}
          {TYPE_ORDER.map((type) => {
            const list = recs.filter((r) => r.type === type);
            if (!list.length) return null;
            return (
              <div key={type} className="mt-4">
                <h4 className="text-sm font-semibold text-slate-700 mb-2">{REC_TYPE_LABEL[type]} ({list.length})</h4>
                <div className="space-y-2">
                  {list.map((r) => (
                    <RecCard key={r.key} rec={r} selected={selection?.key === r.key} onToggle={() => toggleSel(r.key, r.keywords)}
                      renderCards={renderCards} pageOptions={pageOptions}
                      onAccept={async (p) => { await api.acceptStructureDecision(cid, r, { ...p, color: nextColor }); refreshAll(); onSelect(null); }} />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function ActionList({ actions }: { actions: StructureAction[] }) {
  if (!actions.length) return null;
  return (
    <ul className="text-xs space-y-0.5">
      {actions.map((a) => (
        <li key={a.keyword} className="flex flex-wrap gap-1">
          <b>{a.keyword}</b> ←
          {a.page_url
            ? <a href={a.page_url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-0.5"><ExternalLink size={10} />{decodePath(a.page_url)}</a>
            : <span className="text-violet-700">עמוד חדש</span>}
        </li>
      ))}
    </ul>
  );
}

function RecCard({ rec, selected, onToggle, renderCards, pageOptions, onAccept }: {
  rec: StructureRec; selected: boolean; onToggle: () => void; renderCards: (k: string[]) => ReactNode;
  pageOptions: { url: string; label: string }[];
  onAccept: (p: { actions: StructureAction[]; mode: "full" | "partial" | "note"; note: string | null }) => Promise<void>;
}) {
  const [mode, setMode] = useState<null | "partial" | "note">(null);
  const [note, setNote] = useState("");
  const SKIP = "__skip__", NEW = "__new__";
  // Partial editor: one row per keyword, prefilled from the AI's proposed action.
  const [choice, setChoice] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const k of rec.keywords) { const a = rec.actions.find((x) => x.keyword === k); m[k] = a ? (a.page_url || NEW) : SKIP; }
    return m;
  });
  const save = useMutation({ mutationFn: onAccept });
  const partialActions = (): StructureAction[] => Object.entries(choice).filter(([, v]) => v !== SKIP)
    .map(([keyword, v]) => ({ keyword, page_url: v === NEW ? null : v, intent: v === NEW ? "new_page" : "strengthen" }));
  const opts = [...new Map([...rec.pages.map((u) => [u, decodePath(u)] as const), ...pageOptions.map((p) => [p.url, p.label] as const)]).entries()];
  const c = SELECTED_COLOR;

  return (
    <div className="rounded-lg border p-3" style={selected ? { background: c.bg, borderColor: c.border, borderRightWidth: 5 } : { borderColor: "#e2e8f0" }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-slate-900">{rec.title}</span>
        <span className={`badge ${rec.priority === "high" ? "bg-rose-50 text-rose-600" : rec.priority === "low" ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-700"}`}>{PRI[rec.priority]}</span>
      </div>
      <div className="text-sm text-slate-700 mt-1 whitespace-pre-wrap"><b>למה:</b> {rec.explanation}</div>
      {rec.extra_steps && <div className="text-sm text-slate-700 mt-1 whitespace-pre-wrap"><b>צעדים נוספים:</b> {rec.extra_steps}</div>}
      {rec.new_page_title && <div className="text-sm text-violet-700 mt-1"><b>כותרת מוצעת לעמוד החדש:</b> {rec.new_page_title}</div>}
      {rec.intent_analysis && (
        <details className="mt-2 bg-white border border-slate-200 rounded-lg p-2" open={selected}>
          <summary className="cursor-pointer text-sm font-medium text-brand-700">כוונת המשתמש של הקבוצה (מפורט)</summary>
          <div className="mt-2"><Md text={rec.intent_analysis} /></div>
        </details>
      )}
      <div className="mt-2"><ActionList actions={rec.actions} /></div>
      <button className="mt-2 text-sm font-medium inline-flex items-center gap-1 text-amber-700 hover:underline" onClick={onToggle}>
        {selected ? <EyeOff size={14} /> : <Eye size={14} />} {selected ? "הסתר את המילים והעמודים" : `הצג את המילים והעמודים של ההמלצה (${rec.keywords.length})`}
      </button>

      {selected && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-amber-800">המילים של ההמלצה מסומנות בצבע הזה גם בטבלה למטה.</p>
          <div className="space-y-3 bg-white/70 rounded-lg p-2">{renderCards(rec.keywords)}</div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-primary text-sm" disabled={save.isPending} onClick={() => save.mutate({ actions: rec.actions, mode: "full", note: null })}>
              {save.isPending && !mode ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} קבל את ההמלצה
            </button>
            <button className={`btn-secondary text-sm ${mode === "partial" ? "ring-2 ring-amber-300" : ""}`} onClick={() => setMode(mode === "partial" ? null : "partial")}><PencilLine size={14} /> קבל חלקית עם שינויים</button>
            <button className={`btn-secondary text-sm ${mode === "note" ? "ring-2 ring-amber-300" : ""}`} onClick={() => setMode(mode === "note" ? null : "note")}><StickyNote size={14} /> קבל עם הערה</button>
          </div>

          {mode === "partial" && (
            <div className="bg-white border border-amber-200 rounded-lg p-3 space-y-2">
              <p className="text-xs text-slate-500">שנה את עמוד היעד של כל מילה, או בחר "בלי שינוי" כדי לא לכלול אותה בהחלטה.</p>
              {rec.keywords.map((k) => (
                <div key={k} className="flex items-center gap-2 flex-wrap text-sm">
                  <span className="font-medium min-w-[140px]">{k}</span>
                  <select className="input py-1 text-xs w-auto max-w-[320px]" value={choice[k]} onChange={(e) => setChoice((m) => ({ ...m, [k]: e.target.value }))}>
                    <option value={SKIP}>בלי שינוי (לא לכלול)</option>
                    <option value={NEW}>➕ עמוד חדש</option>
                    {opts.map(([u, label]) => <option key={u} value={u}>{label}</option>)}
                  </select>
                </div>
              ))}
              <textarea className="input w-full text-sm" rows={2} placeholder="הערה (אופציונלי): מה שינית ולמה" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn-primary text-sm" disabled={save.isPending} onClick={() => save.mutate({ actions: partialActions(), mode: "partial", note: note.trim() || null })}>
                {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} אשר עם השינויים
              </button>
            </div>
          )}
          {mode === "note" && (
            <div className="bg-white border border-amber-200 rounded-lg p-3 space-y-2">
              <textarea className="input w-full text-sm" rows={3} placeholder="ההערה תישמר עם ההחלטה ותיכנס למשימה בתכנית העבודה" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn-primary text-sm" disabled={save.isPending || !note.trim()} onClick={() => save.mutate({ actions: rec.actions, mode: "note", note: note.trim() })}>
                {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} אשר עם ההערה
              </button>
            </div>
          )}
          {save.isError && <div className="text-sm text-rose-600">שגיאה: {(save.error as Error).message}</div>}
        </div>
      )}
    </div>
  );
}
