import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Loader2, Check, PencilLine, StickyNote, Eye, EyeOff, ExternalLink, CheckCircle2, Bot, Network, ListChecks, MessageCircle, FilePlus, ChevronDown, ChevronUp, PlayCircle } from "lucide-react";
import * as api from "../api";
import type { StructureAction, StructureDecision, StructureRec, StructureAnalysis } from "../api";
import { SELECTED_COLOR, REC_TYPE_LABEL } from "../lib/decisionColors";
import { Md } from "./RichText";
import Considerations from "./Considerations";
import StructureChat from "./StructureChat";
import { SiteScanNote } from "./SiteScanPanel";

function decodePath(u: string): string {
  try { return decodeURIComponent(u.replace(/^https?:\/\/[^/]+/, "")) || u; } catch { return u; }
}
const PRI: Record<string, string> = { high: "עדיפות גבוהה", medium: "עדיפות בינונית", low: "עדיפות נמוכה" };

export type Selection = { key: string; keywords: string[] } | null;
type Tab = "map" | "recs" | "chat";

/** "יועץ מבנה האתר": one tool for the combined analysis (site map + recommendations) and the chat.
 *  The analysis runs in stages: 1) every keyword → intent cluster, 2) hierarchical site map,
 *  3) recommendations per parent page with structured considerations, 4) detailed user intent. */
export default function StructureAdvisor({ cid, from, to, decisions, selection, onSelect, renderCards, pageOptions, kwLines }: {
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
  const [tab, setTab] = useState<Tab | null>(null);
  const [open, setOpen] = useState(true);
  const [prog, setProg] = useState<{ label: string; done?: number; total?: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ text: string; id: number } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["structure-analysis", cid] });

  const acceptedKeys = new Set(decisions.map((d) => d.rec_key));
  const allRecs = analysis?.recs || [];
  const recs = allRecs.filter((r) => !acceptedKeys.has(r.key));
  const nextColor = decisions.length ? Math.max(...decisions.map((d) => d.color)) + 1 : 0;
  const activeTab: Tab = tab ?? (recs.length ? "recs" : analysis?.hierarchy ? "map" : "chat");

  // Run `fn` over items, 3 at a time.
  const pool = async <T,>(items: T[], fn: (t: T) => Promise<void>) => {
    let i = 0;
    await Promise.all([0, 1, 2].map(async () => { while (i < items.length) await fn(items[i++]); }));
  };

  const fillIntents = async (list: StructureRec[]) => {
    const todo = list.filter((r) => !r.intent_analysis && r.keywords.length > 0);
    if (!todo.length) return list;
    const out = new Map<string, string>(); let done = 0;
    const label = "שלב 4 מתוך 4: כותב כוונת משתמש מפורטת לכל המלצה";
    setProg({ label, done: 0, total: todo.length });
    await pool(todo, async (r) => {
      try { out.set(r.key, (await api.structureRecIntent(cid, r, kwLines(r.keywords))).intent_analysis); } catch { /* can be completed later */ }
      setProg({ label, done: ++done, total: todo.length });
    });
    const merged = list.map((r) => (out.has(r.key) ? { ...r, intent_analysis: out.get(r.key) } : r));
    await api.saveStructureRecs(cid, merged);
    return merged;
  };

  /** The staged pipeline. `resume` continues from what is already saved. */
  const runAll = async (resume: boolean) => {
    setErr(null); setTab("map");
    try {
      const a: StructureAnalysis | null = resume ? analysis ?? null : null;
      if (!a?.map) { setProg({ label: "שלב 1 מתוך 4: ממפה את כל מילות המפתח לקבוצות כוונה (כדקה)" }); await api.runStructureStage(cid, from, to, "map"); await refresh(); }
      if (!a?.map || !a?.hierarchy) { setProg({ label: "שלב 2 מתוך 4: בונה מפת אתר היררכית: עמודי אב ועמודי בן (כדקה)" }); await api.runStructureStage(cid, from, to, "hierarchy"); await refresh(); }
      const fresh = await api.getStructureAnalysis(cid);
      const hubIds = [...(fresh?.hierarchy?.hubs || []).map((h) => h.id), "SITE"];
      let recs: StructureRec[] = resume ? [...(fresh?.recs || [])] : [];
      const doneHubs = new Set(recs.map((r) => r.key.split("-")[0]));
      const todo = hubIds.filter((h) => !doneHubs.has(h));
      let done = 0; const failed: string[] = [];
      const label = "שלב 3 מתוך 4: המלצות לכל עמוד אב";
      setProg({ label, done: 0, total: todo.length });
      await pool(todo, async (h) => {
        try { const r = await api.runStructureStage(cid, from, to, "recs", h); recs = [...recs, ...(r.recs || [])]; await api.saveStructureRecs(cid, recs); }
        catch { failed.push(h); }
        setProg({ label, done: ++done, total: todo.length });
      });
      await api.saveStructureRecs(cid, recs);
      await refresh();
      if (failed.length) setErr(`${failed.length} חלקים לא הושלמו. אפשר ללחוץ "המשך את הניתוח" כדי להשלים רק אותם.`);
      await fillIntents(recs);
      setTab("recs");
    } catch (e) {
      setErr(`${(e as Error).message}. אפשר ללחוץ "המשך את הניתוח" כדי להמשיך מאיפה שעצר.`);
    } finally { setProg(null); refresh(); }
  };

  const hubsCount = analysis?.hierarchy?.hubs?.length || 0;
  const recsHubs = new Set(allRecs.map((r) => r.key.split("-")[0]));
  const incomplete = !!analysis?.map && (!analysis.hierarchy || ![...(analysis.hierarchy.hubs || []).map((h) => h.id), "SITE"].every((h) => recsHubs.has(h)));
  const missingIntent = allRecs.filter((r) => !r.intent_analysis && r.keywords.length > 0).length;
  const askAbout = (r: StructureRec) => { setTab("chat"); setAsk({ text: `לגבי ההמלצה "${r.title}" (key: ${r.key}): פרט את השיקולים ואת החלופות, ומה היית עושה אחרת אם בכלל?`, id: Date.now() }); };

  const TabBtn = ({ k, icon, label }: { k: Tab; icon: ReactNode; label: string }) => (
    <button className={`text-sm px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 ${activeTab === k ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`} onClick={() => setTab(k)}>{icon} {label}</button>
  );

  return (
    <div className="card mb-4 border-r-4 border-r-brand-400">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button className="font-semibold flex items-center gap-2 text-slate-800" onClick={() => setOpen((o) => !o)}>
          <Bot size={18} className="text-brand-600" /> יועץ מבנה האתר (AI): ניתוח כולל ושיחה
          {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          {analysis?.created_at && <span className="text-xs text-slate-400">ניתוח אחרון: {new Date(analysis.created_at).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}</span>}
          {incomplete && !prog && <button className="btn-secondary text-sm" onClick={() => runAll(true)}><PlayCircle size={15} /> המשך את הניתוח</button>}
          <button className="btn-primary text-sm" disabled={!!prog} onClick={() => { if (!analysis || confirm("להריץ ניתוח כולל חדש? ההמלצות הפתוחות הנוכחיות יוחלפו (החלטות שאושרו נשמרות).")) runAll(false); }}>
            {prog ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {analysis?.map ? "נתח מחדש" : "ניתוח AI כולל"}
          </button>
        </div>
      </div>
      {open && (
        <>
          <div className="mt-1"><SiteScanNote cid={cid} /></div>
          {prog && (
            <div className="mt-3 text-sm text-slate-600 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap">
              <Loader2 size={14} className="animate-spin shrink-0" /> {prog.label}{prog.total ? ` · ${prog.done}/${prog.total}` : ""}
              <span className="text-xs text-slate-400 mr-auto">יש להשאיר את הדף פתוח עד הסיום</span>
            </div>
          )}
          {err && <div className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}
          {!prog && missingIntent > 0 && !incomplete && (
            <button className="mt-3 btn-secondary text-xs" onClick={async () => { await fillIntents(allRecs); setProg(null); refresh(); }}><Sparkles size={13} /> השלם כוונת משתמש ל-{missingIntent} המלצות</button>
          )}
          {decisions.length > 0 && (
            <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
              <span className="text-emerald-800 inline-flex items-center gap-1.5"><CheckCircle2 size={15} /> {decisions.length} החלטות אושרו. הן צבועות בטבלה למטה, והרשימה המלאה עם השיקולים וכפתור הביטול נמצאת בלשונית כוונת המשתמש.</span>
              <Link to={`/clients/${cid}/user-intent`} className="text-xs text-emerald-700 font-medium hover:underline">לרשימת ההחלטות ←</Link>
            </div>
          )}

          <div className="flex gap-1 mt-3 border-b border-slate-100 pb-2 flex-wrap">
            <TabBtn k="map" icon={<Network size={15} />} label={`מפת האתר${hubsCount ? ` (${hubsCount} עמודי אב)` : ""}`} />
            <TabBtn k="recs" icon={<ListChecks size={15} />} label={`המלצות (${recs.length})`} />
            <TabBtn k="chat" icon={<MessageCircle size={15} />} label="שיחה" />
          </div>

          <div className="mt-3">
            {activeTab === "map" && <SiteMapView analysis={analysis ?? null} onSelect={onSelect} selection={selection} />}
            {activeTab === "recs" && (
              recs.length === 0 ? (
                <p className="text-sm text-slate-400">{analysis?.map ? "אין המלצות פתוחות." : 'עדיין לא בוצע ניתוח. לחץ "ניתוח AI כולל".'}</p>
              ) : (
                <RecsByHub recs={recs} hubOrder={(analysis?.hierarchy?.hubs || []).map((h) => h.name)} selection={selection}
                  onToggle={(r) => onSelect(selection?.key === r.key ? null : { key: r.key, keywords: r.keywords })}
                  renderCards={renderCards} pageOptions={pageOptions} onAsk={askAbout}
                  onAccept={async (r, p) => { await api.acceptStructureDecision(cid, r, { ...p, color: nextColor }); qc.invalidateQueries({ queryKey: ["structure-decisions", cid] }); qc.invalidateQueries({ queryKey: ["kw-targets", cid] }); onSelect(null); }} />
              )
            )}
            {/* Kept mounted so the conversation isn't lost when switching tabs */}
            <div className={activeTab === "chat" ? "" : "hidden"}>
              <StructureChat cid={cid} from={from} to={to} ask={ask} onAnswered={(proposed) => { if (proposed.length) refresh(); }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Stage 1+2 output: the hierarchical site map (parent → children) and every intent cluster. */
function SiteMapView({ analysis, onSelect, selection }: { analysis: StructureAnalysis | null; onSelect: (s: Selection) => void; selection: Selection }) {
  const [showClusters, setShowClusters] = useState(false);
  if (!analysis?.map) return <p className="text-sm text-slate-400">עדיין לא בוצע ניתוח. לחץ "ניתוח AI כולל" כדי לבנות את מפת האתר.</p>;
  const clusters = analysis.map.clusters || [];
  const byId = new Map(clusters.map((c) => [c.id, c]));
  const kwsOf = (ids: string[]) => ids.flatMap((id) => byId.get(id)?.keywords || []);
  const PageRef = ({ url, title }: { url: string | null; title: string }) => url
    ? <a href={url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline inline-flex items-center gap-0.5 text-sm"><ExternalLink size={11} />{decodePath(url)}</a>
    : <span className="text-violet-700 inline-flex items-center gap-0.5 text-sm"><FilePlus size={12} /> עמוד חדש: {title || "—"}</span>;
  const ShowBtn = ({ k, kws }: { k: string; kws: string[] }) => kws.length ? (
    <button className="text-xs text-amber-700 hover:underline inline-flex items-center gap-0.5" onClick={() => onSelect(selection?.key === k ? null : { key: k, keywords: kws })}>
      {selection?.key === k ? <EyeOff size={12} /> : <Eye size={12} />} {kws.length} מילים {selection?.key === k ? "(מסומנות בטבלה)" : "· סמן בטבלה"}
    </button>
  ) : null;

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500">
        מיפוי מלא: <b>{analysis.map.mapped}</b> מתוך <b>{analysis.map.total}</b> מילות מפתח סווגו ל-{clusters.length} קבוצות כוונה
        {analysis.map.missing > 0 && <span className="text-amber-700"> · {analysis.map.missing} לא סווגו (בקבוצה "לא סווגו")</span>}
        {analysis.map.scan_date ? ` · תוכן הדפים מסריקה מ-${new Date(analysis.map.scan_date).toLocaleDateString("he-IL")}` : " · ללא טקסט דפים (לא בוצעה סריקה)"}
      </div>
      {!analysis.hierarchy ? <p className="text-sm text-slate-400">מפת האתר עוד לא נבנתה. לחץ "המשך את הניתוח".</p> : (
        <>
          {analysis.hierarchy.hubs.map((h) => (
            <div key={h.id} className="border border-slate-200 rounded-lg p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="badge bg-brand-100 text-brand-800">עמוד אב</span>
                <span className="font-semibold text-slate-900">{h.name}</span>
                <PageRef url={h.page_url} title={h.new_title} />
                <ShowBtn k={`hub-${h.id}`} kws={[...kwsOf(h.clusters), ...h.children.flatMap((c) => kwsOf(c.clusters))]} />
              </div>
              {h.why && <Md text={h.why} className="mt-1 text-slate-700" />}
              {h.children.length > 0 && (
                <ul className="mt-2 border-r-2 border-brand-100 pr-3 space-y-1.5">
                  {h.children.map((c, i) => (
                    <li key={i}>
                      <div className="flex items-center gap-2 flex-wrap text-sm">
                        <span className="text-slate-400">└</span><span className="font-medium">{c.name}</span>
                        <PageRef url={c.page_url} title={c.new_title} />
                        <ShowBtn k={`child-${h.id}-${i}`} kws={kwsOf(c.clusters)} />
                      </div>
                      {c.why && <div className="pr-4"><Md text={c.why} className="text-xs text-slate-600" /></div>}
                    </li>
                  ))}
                </ul>
              )}
              {h.alternatives.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <div className="text-xs font-semibold text-slate-600 mb-0.5">חלופות שנשקלו</div>
                  <table className="w-full text-xs border border-slate-200">
                    <thead><tr className="bg-slate-50 text-right"><th className="px-2 py-1 font-medium">חלופה</th><th className="px-2 py-1 font-medium">יתרונות</th><th className="px-2 py-1 font-medium">חסרונות</th></tr></thead>
                    <tbody>{h.alternatives.map((a, i) => (
                      <tr key={i} className={`border-t border-slate-100 align-top ${a.recommended ? "bg-emerald-50" : ""}`}>
                        <td className="px-2 py-1 font-medium">{a.option}{a.recommended && <span className="badge bg-emerald-100 text-emerald-700 mr-1">מומלץ</span>}</td>
                        <td className="px-2 py-1 text-emerald-800">{a.pros}</td><td className="px-2 py-1 text-rose-800">{a.cons}</td>
                      </tr>))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          {analysis.hierarchy.notes && <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs font-semibold text-slate-600 mb-1">הערות על המבנה</div><Md text={analysis.hierarchy.notes} /></div>}
        </>
      )}
      <button className="text-xs text-slate-500 hover:text-brand-600 inline-flex items-center gap-1" onClick={() => setShowClusters((s) => !s)}>
        {showClusters ? <ChevronUp size={12} /> : <ChevronDown size={12} />} כל קבוצות הכוונה ({clusters.length})
      </button>
      {showClusters && (
        <div className="grid md:grid-cols-2 gap-2">
          {clusters.map((c) => (
            <div key={c.id} className={`border rounded-lg p-2 text-xs ${c.id === "C_OTHER" ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}>
              <div className="flex items-center gap-1.5 flex-wrap"><b className="text-slate-800 text-sm">{c.name}</b>{c.stage && <span className="badge bg-slate-100 text-slate-600">{c.stage}</span>}<ShowBtn k={`cl-${c.id}`} kws={c.keywords} /></div>
              <div className="text-slate-600 mt-0.5">{c.intent}</div>
              <div className="flex flex-wrap gap-1 mt-1">{c.keywords.map((k) => <span key={k} className="bg-slate-100 rounded px-1.5 py-0.5">{k}</span>)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type CardProps = {
  onToggle: (r: StructureRec) => void; renderCards: (k: string[]) => ReactNode;
  pageOptions: { url: string; label: string }[];
  onAccept: (r: StructureRec, p: { actions: StructureAction[]; mode: "full" | "partial" | "note"; note: string | null }) => Promise<void>;
  onAsk: (r: StructureRec) => void;
};

/** Recommendations grouped by the parent page they belong to (in site-map order). */
function RecsByHub({ recs, hubOrder, selection, ...cardProps }: { recs: StructureRec[]; hubOrder: string[]; selection: Selection } & CardProps) {
  const groups = new Map<string, StructureRec[]>();
  for (const r of recs) { const h = r.hub || REC_TYPE_LABEL[r.type] || "אחר"; if (!groups.has(h)) groups.set(h, []); groups.get(h)!.push(r); }
  const order = [...hubOrder.filter((h) => groups.has(h)), ...[...groups.keys()].filter((h) => !hubOrder.includes(h))];
  return (
    <div className="space-y-4">
      {order.map((h) => (
        <div key={h}>
          <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5"><Network size={14} className="text-brand-600" /> {h} ({groups.get(h)!.length})</h4>
          <div className="space-y-2">{groups.get(h)!.map((r) => <RecCard key={r.key} rec={r} selected={selection?.key === r.key} {...cardProps} />)}</div>
        </div>
      ))}
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
            ? <a href={a.page_url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline inline-flex items-center gap-0.5"><ExternalLink size={10} />{decodePath(a.page_url)}</a>
            : <span className="text-violet-700">עמוד חדש</span>}
        </li>
      ))}
    </ul>
  );
}

function RecCard({ rec, selected, onToggle, renderCards, pageOptions, onAccept, onAsk }: { rec: StructureRec; selected: boolean } & CardProps) {
  const [mode, setMode] = useState<null | "partial" | "note">(null);
  const [note, setNote] = useState("");
  const SKIP = "__skip__", NEW = "__new__";
  const [choice, setChoice] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const k of rec.keywords) { const a = rec.actions.find((x) => x.keyword === k); m[k] = a ? (a.page_url || NEW) : SKIP; }
    return m;
  });
  const save = useMutation({ mutationFn: (p: { actions: StructureAction[]; mode: "full" | "partial" | "note"; note: string | null }) => onAccept(rec, p) });
  const partialActions = (): StructureAction[] => Object.entries(choice).filter(([, v]) => v !== SKIP)
    .map(([keyword, v]) => ({ keyword, page_url: v === NEW ? null : v, intent: v === NEW ? "new_page" : "strengthen" }));
  const opts = [...new Map([...rec.pages.map((u) => [u, decodePath(u)] as const), ...pageOptions.map((p) => [p.url, p.label] as const)]).entries()];
  const c = SELECTED_COLOR;

  return (
    <div className="rounded-lg border p-3" style={selected ? { background: c.bg, borderColor: c.border, borderRightWidth: 5 } : { borderColor: "#e2e8f0" }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-slate-900">{rec.title}</span>
        <span className="badge bg-slate-100 text-slate-600">{REC_TYPE_LABEL[rec.type] || rec.type}</span>
        <span className={`badge ${rec.priority === "high" ? "bg-rose-50 text-rose-600" : rec.priority === "low" ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-700"}`}>{PRI[rec.priority]}</span>
      </div>
      {rec.explanation && <Md text={rec.explanation} className="mt-1" />}
      {rec.new_page_title && <div className="text-sm text-violet-700 mt-1"><b>כותרת מוצעת לעמוד החדש:</b> {rec.new_page_title}</div>}
      <div className="mt-2"><ActionList actions={rec.actions} /></div>

      <div className="flex flex-wrap gap-3 mt-2">
        <button className="text-sm font-medium inline-flex items-center gap-1 text-amber-700 hover:underline" onClick={() => onToggle(rec)}>
          {selected ? <EyeOff size={14} /> : <Eye size={14} />} {selected ? "סגור" : `שיקולים, מילים ועמודים (${rec.keywords.length})`}
        </button>
        <button className="text-sm inline-flex items-center gap-1 text-brand-700 hover:underline" onClick={() => onAsk(rec)}><MessageCircle size={14} /> שאל על ההמלצה בשיחה</button>
      </div>

      {selected && (
        <div className="mt-3 space-y-3">
          <Considerations c={rec.considerations} />
          {rec.extra_steps && <div className="bg-white border border-slate-200 rounded-lg p-3"><div className="text-sm font-semibold text-slate-800 mb-1">צעדים נוספים</div><Md text={rec.extra_steps} /></div>}
          {rec.intent_analysis && (
            <details className="bg-white border border-slate-200 rounded-lg p-3">
              <summary className="cursor-pointer text-sm font-semibold text-brand-700">כוונת המשתמש של הקבוצה (מפורט)</summary>
              <div className="mt-2"><Md text={rec.intent_analysis} /></div>
            </details>
          )}
          {rec.keywords.length > 0 && (
            <>
              <p className="text-xs text-amber-800">המילים של ההמלצה מסומנות בצבע הזה גם בטבלה למטה.</p>
              <div className="space-y-3 bg-white/70 rounded-lg p-2">{renderCards(rec.keywords)}</div>
            </>
          )}

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
