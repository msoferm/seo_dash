import { useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, Upload, Plus, Trash2, ListTodo, CheckCircle2, Loader2, Check, X, Bot, User,
  ChevronDown, ChevronUp, ExternalLink, Activity, Wrench, Gauge, FileText, TrendingUp, Link2, Target,
} from "lucide-react";
import * as api from "../api";
import type { Task, Level } from "../api";
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

function deepLink(cid: number, t: Task): { href: string; label: string } | null {
  if (t.source_type === "recommendation") return { href: `/clients/${cid}/engine`, label: "מנוע המלצות" };
  if (t.source_type === "audit") return { href: `/clients/${cid}/seo-tools`, label: "כלי SEO" };
  if (t.source_ref === "forums" || t.source_ref === "prospects") return { href: `/clients/${cid}/prospects`, label: "איתור קישורים" };
  if (t.source_ref === "faq") return { href: `/clients/${cid}/pages`, label: "עמודים / FAQ" };
  return null;
}

/* ---------- Subtask row ---------- */
function SubtaskRow({ t, cid, onExecute, onIgnore, onReopen, executing, execError }: {
  t: Task; cid: number;
  onExecute: (t: Task) => void; onIgnore: (id: number) => void; onReopen: (id: number) => void;
  executing: boolean; execError?: string;
}) {
  const [open, setOpen] = useState(false);
  const done = t.status === "done";
  const ignored = t.status === "ignored";
  const link = deepLink(cid, t);
  const isClaude = t.kind === "claude";

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
            {t.target_month && <span className="badge bg-slate-100 text-slate-600">חודש {t.target_month}</span>}
            {t.priority && <span className={`badge ${PRIORITY_BADGE[t.priority]}`}>עדיפות {PRIORITY_LABEL[t.priority]}</span>}
            <span className={`badge ${isClaude ? "bg-brand-50 text-brand-700" : "bg-violet-50 text-violet-700"}`}>
              {isClaude ? <><Bot size={11} /> קלוד מבצע</> : <><User size={11} /> ידני + הנחיה</>}
            </span>
            {t.impact && <span className="badge bg-slate-100 text-slate-500">השפעה {PRIORITY_LABEL[t.impact]}</span>}
            {link && <Link to={link.href} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-0.5"><ExternalLink size={11} /> {link.label}</Link>}
            {done && t.source_type === "recommendation" && <Link to={`/clients/${cid}/impact`} className="text-xs text-emerald-600 hover:underline inline-flex items-center gap-0.5"><Activity size={11} /> מעקב השפעה</Link>}
          </div>

          {t.note && (
            <div className="mt-2">
              <button className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1" onClick={() => setOpen((o) => !o)}>
                {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {isClaude ? "תוצאת הביצוע" : "הנחיית ביצוע"}
              </button>
              {open && <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3">{t.note}</div>}
            </div>
          )}
          {execError && <div className="mt-1.5 text-xs text-rose-600">{execError}</div>}
        </div>

        <div className="shrink-0 flex items-center gap-1">
          {t.status === "open" ? (
            <>
              <button className="btn-primary text-xs py-1 px-2" disabled={executing} onClick={() => onExecute(t)}>
                {executing ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} בצע
              </button>
              <button className="text-xs py-1 px-2 rounded text-slate-500 hover:bg-slate-100" onClick={() => onIgnore(t.id)}>התעלם</button>
            </>
          ) : (
            <button className="text-xs py-1 px-2 rounded text-brand-600 hover:bg-brand-50" onClick={() => onReopen(t.id)}>החזר</button>
          )}
        </div>
      </div>
    </li>
  );
}

/* ---------- Pillar card ---------- */
function PillarCard({ pillar, subs, cid, exec, ignore, reopen, execVarId, execErr }: {
  pillar: Task; subs: Task[]; cid: number;
  exec: (t: Task) => void; ignore: (id: number) => void; reopen: (id: number) => void;
  execVarId?: number; execErr?: { id: number; msg: string };
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
          {subs.map((s) => (
            <SubtaskRow key={s.id} t={s} cid={cid}
              onExecute={exec} onIgnore={ignore} onReopen={reopen}
              executing={execVarId === s.id}
              execError={execErr?.id === s.id ? execErr.msg : undefined}
            />
          ))}
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
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: tasks, isLoading } = useQuery({ queryKey: ["tasks", cid], queryFn: () => api.listTasks(cid), enabled: !!cid });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tasks", cid] });

  const plan = useMutation({ mutationFn: () => api.generateWorkPlan(cid), onSuccess: invalidate });
  const upload = useMutation({ mutationFn: (titles: string[]) => api.bulkCreateTasks(cid, titles), onSuccess: invalidate });
  const create = useMutation({ mutationFn: (title: string) => api.createTask(cid, title), onSuccess: () => { setNewTitle(""); invalidate(); } });
  const toggle = useMutation({ mutationFn: ({ id, done }: { id: number; done: boolean }) => api.setTaskDone(id, done), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteTask(id), onSuccess: invalidate });

  const ignore = useMutation({ mutationFn: (id: number) => api.setTaskStatus(id, "ignored"), onSuccess: invalidate });
  const reopen = useMutation({ mutationFn: (id: number) => api.setTaskStatus(id, "open"), onSuccess: invalidate });
  const execute = useMutation({
    mutationFn: async (t: Task) => {
      if (t.source_type === "recommendation" && t.source_ref) {
        const r = await api.applyRecommendation(Number(t.source_ref));
        await api.setTaskStatus(t.id, "done", r.note);
      } else if (t.source_type === "audit" && t.source_ref) {
        const r = await api.applyAuditFix(Number(t.source_ref));
        await api.setTaskStatus(t.id, "done", r.note);
      } else {
        await api.guideTask(t.id); // manual/tool → guidance + marks done server-side
      }
    },
    onSuccess: invalidate,
  });
  const execErr = execute.isError && execute.variables ? { id: (execute.variables as Task).id, msg: (execute.error as any)?.message || "שגיאה" } : undefined;

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
    .sort((a, b) => (a.target_month || 9) - (b.target_month || 9) || a.sort_order - b.sort_order);
  const loose = all.filter((t) => t.source !== "plan" && !t.is_pillar);
  const looseOpen = loose.filter((t) => t.status === "open");
  const looseDone = loose.filter((t) => t.status !== "open");

  return (
    <div>
      <PageHeader
        title="לוח משימות"
        subtitle="תכנית עבודה אסטרטגית ל-3 חודשים — נבנית מכל נתוני המערכת"
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

      {/* manual quick-add */}
      <div className="card mb-6">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newTitle.trim()) create.mutate(newTitle.trim()); }}>
          <input className="input flex-1" placeholder="הוסף משימה ידנית..." value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <button type="submit" className="btn-primary shrink-0" disabled={create.isPending || !newTitle.trim()}><Plus size={18} /> הוסף</button>
        </form>
      </div>

      {isLoading ? (
        <Spinner />
      ) : pillars.length === 0 && loose.length === 0 ? (
        <div className="card text-center py-12 text-slate-500">
          <ListTodo size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-slate-700 font-medium mb-1">אין עדיין תכנית עבודה</p>
          <p className="text-sm">לחץ "בנה תכנית 3 חודשים" — קלוד יבנה תכנית אסטרטגית מכל נתוני המערכת (מנוע המלצות, אודיט, קישורים ועוד).</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pillars.map((p) => (
            <PillarCard key={p.id} pillar={p} subs={subsByPillar(p.id)} cid={cid}
              exec={(t) => execute.mutate(t)} ignore={(id) => ignore.mutate(id)} reopen={(id) => reopen.mutate(id)}
              execVarId={execute.isPending ? (execute.variables as Task)?.id : undefined} execErr={execErr} />
          ))}

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
