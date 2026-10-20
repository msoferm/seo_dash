import { useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, Upload, Plus, Trash2, ListTodo, CheckCircle2, Loader2, Check, CheckCheck, X, Bot, User,
  ChevronDown, ChevronUp, ExternalLink, Activity, Wrench, Gauge, FileText, TrendingUp, Link2, Target,
  MessageSquare, CalendarDays, LayoutList, PenTool, ListChecks,
} from "lucide-react";
import * as api from "../api";
import type { Task, Level, RecStatus } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

const PILLAR_META: Record<string, { label: string; icon: typeof Wrench }> = {
  technical: { label: "תשתית טכנית ואינדוקס", icon: Wrench },
  speed: { label: "מהירות ו-Core Web Vitals", icon: Gauge },
  content: { label: "אופטימיזציית תוכן על-עמודית", icon: FileText },
  traffic: { label: "הרחבת תנועה ותוכן חדש", icon: TrendingUp },
  authority: { label: "סמכות וקישורים", icon: Link2 },
  conversions: { label: "המרות ו-UX", icon: Target },
};
const PRIORITY_LABEL: Record<Level, string> = { high: "גבוהה", medium: "בינונית", low: "נמוכה" };
const PRIORITY_BADGE: Record<Level, string> = { high: "bg-rose-50 text-rose-700", medium: "bg-amber-50 text-amber-700", low: "bg-emerald-50 text-emerald-700" };
const PRI_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

type Action = "execute" | "done" | "ignore" | "reopen";

function deepLink(cid: number, t: Task): { href: string; label: string } | null {
  if (t.source_type === "recommendation") return { href: `/clients/${cid}/engine`, label: "מנוע המלצות" };
  if (t.source_type === "audit") return { href: `/clients/${cid}/seo-tools`, label: "כלי SEO" };
  if (t.source_ref === "forums" || t.source_ref === "prospects") return { href: `/clients/${cid}/prospects`, label: "איתור קישורים" };
  if (t.source_ref === "faq") return { href: `/clients/${cid}/pages`, label: "עמודים / FAQ" };
  return null;
}
function fmtDate(d: string | null): string {
  if (!d) return "";
  try { return new Date(d + "T00:00:00").toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "numeric" }); } catch { return d; }
}

/* ---------- Subtask row ---------- */
function SubtaskRow({ t, cid, onAction, onPreview, busy, previewing, execError, showPillar }: {
  t: Task; cid: number;
  onAction: (t: Task, action: Action, note?: string) => void;
  onPreview: (t: Task) => void;
  busy: boolean; previewing: boolean; execError?: string; showPillar?: boolean;
}) {
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const [openNote, setOpenNote] = useState(false);
  const [openPreview, setOpenPreview] = useState(true);
  const done = t.status === "done";
  const ignored = t.status === "ignored";
  const link = deepLink(cid, t);
  const isClaude = t.kind === "claude";
  const pillar = showPillar && t.category ? PILLAR_META[t.category] : null;
  const overdue = t.status === "open" && !!t.due_date && t.due_date < new Date().toISOString().slice(0, 10);

  return (
    <li className="py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {done ? <CheckCircle2 size={18} className="text-emerald-500" />
            : ignored ? <X size={18} className="text-slate-300" />
            : <div className="w-[18px] h-[18px] rounded-full border-2 border-slate-300" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-medium ${done ? "text-slate-500" : ignored ? "line-through text-slate-400" : "text-slate-900"}`}>{t.title}</div>
          {t.details && <div className="text-xs text-slate-500 mt-0.5">{t.details}</div>}

          <div className="flex flex-wrap gap-1.5 mt-1.5 items-center">
            {pillar && <span className="badge bg-slate-100 text-slate-600 inline-flex items-center gap-1"><pillar.icon size={11} /> {pillar.label}</span>}
            {t.due_date && <span className={`badge inline-flex items-center gap-1 ${overdue ? "bg-rose-50 text-rose-700" : "bg-indigo-50 text-indigo-700"}`}><CalendarDays size={11} /> {fmtDate(t.due_date)}</span>}
            {overdue && <span className="badge bg-rose-100 text-rose-700">באיחור</span>}
            {t.priority && <span className={`badge ${PRIORITY_BADGE[t.priority]}`}>עדיפות {PRIORITY_LABEL[t.priority]}</span>}
            <span className={`badge ${isClaude ? "bg-brand-50 text-brand-700" : "bg-violet-50 text-violet-700"}`}>
              {isClaude ? <><Bot size={11} /> קלוד מבצע</> : <><User size={11} /> ידני + הנחיה</>}
            </span>
            {t.page_url && <a href={t.page_url} target="_blank" rel="noreferrer" className="text-xs text-sky-700 hover:underline inline-flex items-center gap-0.5 font-medium" title={t.page_url}><ExternalLink size={11} /> העמוד באתר</a>}
            {link && <Link to={link.href} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-0.5"><ExternalLink size={11} /> {link.label}</Link>}
            {done && t.source_type === "recommendation" && <Link to={`/clients/${cid}/impact`} className="text-xs text-emerald-600 hover:underline inline-flex items-center gap-0.5"><Activity size={11} /> מעקב השפעה</Link>}
          </div>

          {/* Preview (draft text / detailed steps) */}
          {t.preview && (
            <div className="mt-2">
              <button className="text-xs font-medium text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1" onClick={() => setOpenPreview((o) => !o)}>
                {openPreview ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {t.writes_text ? "טיוטה לבדיקה" : "פירוט ביצוע"}
              </button>
              {openPreview && <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap bg-indigo-50/50 border border-indigo-100 rounded-lg p-3">{t.preview}</div>}
            </div>
          )}

          {t.note && (
            <div className="mt-2">
              <button className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1" onClick={() => setOpenNote((o) => !o)}>
                {openNote ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {isClaude ? "תוצאת הביצוע / הערה" : "הנחיה / הערה"}
              </button>
              {openNote && <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3">{t.note}</div>}
            </div>
          )}
          {execError && <div className="mt-1.5 text-xs text-rose-600">{execError}</div>}

          {/* Note input for "בצע + הערה" */}
          {showNote && t.status === "open" && (
            <div className="mt-2 flex flex-col gap-1.5">
              <textarea className="input py-1 text-sm" rows={2} autoFocus placeholder={isClaude ? "הנחיה לביצוע (למשל: שמור על הטון, הוסף CTA) + הערה שתישמר..." : "הערה שתישמר על המשימה..."}
                value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-1.5">
                <button className="btn-primary text-xs py-1 px-2" disabled={busy} onClick={() => { onAction(t, "execute", note); setShowNote(false); setNote(""); }}>
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} בצע עם הערה
                </button>
                <button className="text-xs py-1 px-2 rounded text-slate-500 hover:bg-slate-100" onClick={() => { setShowNote(false); setNote(""); }}>ביטול</button>
              </div>
            </div>
          )}

          {/* Actions */}
          {t.status === "open" && !showNote && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              <button className="btn-secondary text-xs py-1 px-2 border-indigo-200 text-indigo-700" disabled={previewing} onClick={() => onPreview(t)} title={t.writes_text ? "קלוד יכתוב טיוטה לבדיקה — בלי לבצע" : "קבל פירוט מדויק מה לעשות"}>
                {previewing ? <Loader2 size={13} className="animate-spin" /> : t.writes_text ? <PenTool size={13} /> : <ListChecks size={13} />}
                {t.writes_text ? "כתוב טיוטה" : "פרט מה לעשות"}
              </button>
              <button className="btn-primary text-xs py-1 px-2" disabled={busy} onClick={() => onAction(t, "execute")} title="קלוד מבצע / מכין הנחיה">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} בצע
              </button>
              <button className="btn-secondary text-xs py-1 px-2" onClick={() => setShowNote(true)} title="בצע עם הנחיה/הערה"><MessageSquare size={13} /> בצע + הערה</button>
              <button className="btn-secondary text-xs py-1 px-2" onClick={() => onAction(t, "done")} title="סמן כבוצע (בלי הרצה)"><CheckCheck size={13} /> בוצע</button>
              <button className="text-xs py-1 px-2 rounded text-slate-500 hover:bg-slate-100" onClick={() => onAction(t, "ignore")}>התעלם</button>
            </div>
          )}
          {t.status !== "open" && (
            <div className="mt-2">
              <button className="text-xs py-1 px-2 rounded text-brand-600 hover:bg-brand-50" onClick={() => onAction(t, "reopen")}>החזר לפתוח</button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/* ---------- Pillar card ---------- */
function PillarCard({ pillar, subs, cid, onAction, onPreview, busyId, previewId, execErr }: {
  pillar: Task; subs: Task[]; cid: number;
  onAction: (t: Task, action: Action, note?: string) => void; onPreview: (t: Task) => void;
  busyId?: number; previewId?: number; execErr?: { id: number; msg: string };
}) {
  const [collapsed, setCollapsed] = useState(false);
  const meta = PILLAR_META[pillar.category || ""] || { label: pillar.title, icon: ListTodo };
  const Icon = meta.icon;
  const completed = subs.filter((s) => s.status === "done" || s.status === "ignored").length;
  const allDone = subs.length > 0 && completed === subs.length;

  return (
    <div className={`card ${allDone ? "border-emerald-300 bg-emerald-50/30" : ""}`}>
      <div className="flex items-center justify-between gap-2 cursor-pointer" onClick={() => setCollapsed((c) => !c)}>
        <h3 className={`font-semibold flex items-center gap-2 ${allDone ? "text-emerald-700" : "text-slate-800"}`}>
          {allDone ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Icon size={18} className="text-brand-600" />}
          {meta.label}
          <span className={`text-xs font-normal rounded-full px-2 py-0.5 ${allDone ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{completed}/{subs.length}</span>
          {allDone && <span className="text-xs font-normal text-emerald-600">הושלם ✓</span>}
        </h3>
        {collapsed ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronUp size={18} className="text-slate-400" />}
      </div>
      {!collapsed && (
        <ul className="mt-2">
          {subs.map((s) => <SubtaskRow key={s.id} t={s} cid={cid} onAction={onAction} onPreview={onPreview} busy={busyId === s.id} previewing={previewId === s.id} execError={execErr?.id === s.id ? execErr.msg : undefined} />)}
        </ul>
      )}
    </div>
  );
}

export default function TasksPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const [view, setView] = useState<"pillars" | "agenda">("pillars");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: tasks, isLoading } = useQuery({ queryKey: ["tasks", cid], queryFn: () => api.listTasks(cid), enabled: !!cid });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tasks", cid] });

  const plan = useMutation({ mutationFn: () => api.generateWorkPlan(cid), onSuccess: invalidate });
  const upload = useMutation({ mutationFn: (titles: string[]) => api.bulkCreateTasks(cid, titles), onSuccess: invalidate });
  const create = useMutation({ mutationFn: (title: string) => api.createTask(cid, title), onSuccess: () => { setNewTitle(""); invalidate(); } });
  const toggle = useMutation({ mutationFn: ({ id, done }: { id: number; done: boolean }) => api.setTaskDone(id, done), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteTask(id), onSuccess: invalidate });
  const preview = useMutation({ mutationFn: (t: Task) => api.previewTask(t.id), onSuccess: invalidate });

  async function syncSource(t: Task, status: "done" | "ignored" | "open") {
    if (!t.source_ref) return;
    if (t.source_type === "recommendation") {
      const map: Record<string, RecStatus> = { done: "done", ignored: "ignored", open: "pending" };
      await api.setRecommendationStatus(Number(t.source_ref), map[status]);
    } else if (t.source_type === "audit") {
      const map: Record<string, "pending" | "applied" | "rejected"> = { done: "applied", ignored: "rejected", open: "pending" };
      await api.setAuditStatus(Number(t.source_ref), map[status]);
    }
  }

  const act = useMutation({
    mutationFn: async ({ t, action, note }: { t: Task; action: Action; note?: string }) => {
      if (action === "execute") {
        if (t.source_type === "recommendation" && t.source_ref) {
          const r = await api.applyRecommendation(Number(t.source_ref), note || undefined);
          await api.setTaskStatus(t.id, "done", note ? `${r.note}\nהערה: ${note}` : r.note);
        } else if (t.source_type === "audit" && t.source_ref) {
          const r = await api.applyAuditFix(Number(t.source_ref), note || undefined);
          await api.setTaskStatus(t.id, "done", note ? `${r.note}\nהערה: ${note}` : r.note);
        } else if (note) {
          await api.setTaskStatus(t.id, "done", note);
        } else {
          await api.guideTask(t.id);
        }
      } else if (action === "done") {
        await api.setTaskStatus(t.id, "done");
        await syncSource(t, "done");
      } else if (action === "ignore") {
        await api.setTaskStatus(t.id, "ignored");
        await syncSource(t, "ignored");
      } else if (action === "reopen") {
        await api.setTaskStatus(t.id, "open");
        await syncSource(t, "open");
      }
    },
    onSuccess: invalidate,
  });
  const busyId = act.isPending ? (act.variables as any)?.t?.id : undefined;
  const previewId = preview.isPending ? (preview.variables as any)?.id : undefined;
  const execErr = act.isError && act.variables ? { id: (act.variables as any).t.id, msg: (act.error as any)?.message || "שגיאה" }
    : preview.isError && preview.variables ? { id: (preview.variables as any).id, msg: (preview.error as any)?.message || "שגיאה" } : undefined;
  const onAction = (t: Task, action: Action, note?: string) => act.mutate({ t, action, note });
  const onPreview = (t: Task) => preview.mutate(t);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    const titles = text.split(/\r?\n/).map((l) => l.split(",")[0].trim()).filter(Boolean);
    if (titles.length) upload.mutate(titles);
    if (fileRef.current) fileRef.current.value = "";
  }

  const all = tasks || [];
  const pillars = all.filter((t) => t.is_pillar).sort((a, b) => a.sort_order - b.sort_order);
  const subsByPillar = (pid: number) => all.filter((t) => t.parent_id === pid)
    .sort((a, b) => (a.target_month || 9) - (b.target_month || 9) || (a.due_date || "").localeCompare(b.due_date || "") || a.sort_order - b.sort_order);
  const planSubs = all.filter((t) => t.source === "plan" && !t.is_pillar);
  const loose = all.filter((t) => t.source !== "plan" && !t.is_pillar);
  const looseOpen = loose.filter((t) => t.status === "open");
  const looseDone = loose.filter((t) => t.status !== "open");

  const byDate = new Map<string, Task[]>();
  for (const s of planSubs) { const k = s.due_date || "ללא תאריך"; if (!byDate.has(k)) byDate.set(k, []); byDate.get(k)!.push(s); }
  const dateKeys = [...byDate.keys()].sort((a, b) => (a === "ללא תאריך" ? 1 : b === "ללא תאריך" ? -1 : a.localeCompare(b)));
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="לוח משימות"
        subtitle="תכנית עבודה אסטרטגית ל-3 חודשים, מחולקת לפי ימים — נבנית מכל נתוני המערכת"
        actions={
          <>
            <button className="btn-primary" onClick={() => { if (!pillars.length || confirm("בנייה מחדש תחליף את התכנית הקיימת (משימות ידניות יישמרו). להמשיך?")) plan.mutate(); }} disabled={plan.isPending}>
              {plan.isPending ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              {plan.isPending ? "בונה תכנית..." : pillars.length ? "בנה תכנית מחדש" : "בנה תכנית 3 חודשים"}
            </button>
            <label className="btn-secondary cursor-pointer">
              <Upload size={18} /> העלה קובץ משימות
              <input ref={fileRef} type="file" accept=".txt,.csv" className="hidden" onChange={handleFile} />
            </label>
          </>
        }
      />

      {plan.isError && <div className="mb-4 bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700">שגיאה בבניית התכנית: {(plan.error as any)?.message}</div>}
      {plan.isSuccess && <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">נבנתה תכנית: {(plan.data as any).pillars} עמודי תווך, {(plan.data as any).created} תתי-משימות.{(plan.data as any).note ? ` ${(plan.data as any).note}` : ""}</div>}

      <div className="card mb-6">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newTitle.trim()) create.mutate(newTitle.trim()); }}>
          <input className="input flex-1" placeholder="הוסף משימה ידנית..." value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <button type="submit" className="btn-primary shrink-0" disabled={create.isPending || !newTitle.trim()}><Plus size={18} /> הוסף</button>
        </form>
      </div>

      {pillars.length > 0 && (
        <div className="flex gap-2 mb-4">
          <button onClick={() => setView("pillars")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${view === "pillars" ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}><LayoutList size={15} /> לפי עמוד תווך</button>
          <button onClick={() => setView("agenda")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${view === "agenda" ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}><CalendarDays size={15} /> יומן לפי תאריך</button>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : pillars.length === 0 && loose.length === 0 ? (
        <div className="card text-center py-12 text-slate-500">
          <ListTodo size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-slate-700 font-medium mb-1">אין עדיין תכנית עבודה</p>
          <p className="text-sm">לחץ "בנה תכנית 3 חודשים" — קלוד יבנה תכנית אסטרטגית מכל נתוני המערכת.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {view === "pillars" && pillars.map((p) => (
            <PillarCard key={p.id} pillar={p} subs={subsByPillar(p.id)} cid={cid} onAction={onAction} onPreview={onPreview} busyId={busyId} previewId={previewId} execErr={execErr} />
          ))}

          {view === "agenda" && dateKeys.map((dk) => {
            const items = byDate.get(dk)!.slice().sort((a, b) => (PRI_ORDER[a.priority || "medium"]) - (PRI_ORDER[b.priority || "medium"]));
            const openCount = items.filter((i) => i.status === "open").length;
            const isPast = dk !== "ללא תאריך" && dk < todayIso;
            const isToday = dk === todayIso;
            return (
              <div key={dk} className={`card ${isToday ? "border-brand-300" : ""}`}>
                <h3 className={`font-semibold flex items-center gap-2 mb-1 ${isPast ? "text-slate-400" : "text-slate-800"}`}>
                  <CalendarDays size={17} className={isToday ? "text-brand-600" : "text-slate-400"} />
                  {dk === "ללא תאריך" ? "ללא תאריך" : new Date(dk + "T00:00:00").toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}
                  {isToday && <span className="badge bg-brand-50 text-brand-700">היום</span>}
                  <span className="text-xs font-normal text-slate-400">({openCount} פתוחות)</span>
                </h3>
                <ul>
                  {items.map((s) => <SubtaskRow key={s.id} t={s} cid={cid} onAction={onAction} onPreview={onPreview} busy={busyId === s.id} previewing={previewId === s.id} execError={execErr?.id === s.id ? execErr.msg : undefined} showPillar />)}
                </ul>
              </div>
            );
          })}

          {loose.length > 0 && (
            <div className="card">
              <h3 className="font-semibold mb-2 flex items-center gap-2 text-slate-800"><ListTodo size={18} /> משימות נוספות <span className="text-slate-500 text-sm font-normal">({looseOpen.length} פתוחות)</span></h3>
              <ul>
                {[...looseOpen, ...looseDone].map((t) => (
                  <li key={t.id} className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0">
                    <input type="checkbox" checked={t.status === "done"} onChange={(e) => toggle.mutate({ id: t.id, done: e.target.checked })} className="mt-1 h-4 w-4 shrink-0 accent-brand-600 cursor-pointer" />
                    <div className="flex-1 min-w-0">
                      <div className={`font-medium ${t.status === "done" ? "line-through text-slate-400" : "text-slate-900"}`}>{t.title}</div>
                      {t.details && <div className="text-xs text-slate-500 mt-0.5">{t.details}</div>}
                    </div>
                    <button className="text-slate-400 hover:text-rose-600 p-1 shrink-0" title="מחק" onClick={() => remove.mutate(t.id)}><Trash2 size={16} /></button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
