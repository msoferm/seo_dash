import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radar, Loader2, ExternalLink, Trash2, Check, Mail, Copy, X, ThumbsUp, Settings2, CalendarClock, Save } from "lucide-react";
import * as api from "../api";
import type { LinkProspect, ProspectStatus, ProspectType } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

const TYPE_LABEL: Record<ProspectType, string> = {
  directory: "אינדקס עסקים", blog: "בלוג / אורח", forum: "פורום", mention: "אזכור מותג", local: "רישום מקומי", other: "אחר",
};
const TYPE_BADGE: Record<ProspectType, string> = {
  directory: "bg-blue-50 text-blue-700", blog: "bg-purple-50 text-purple-700", forum: "bg-amber-50 text-amber-700",
  mention: "bg-emerald-50 text-emerald-700", local: "bg-teal-50 text-teal-700", other: "bg-slate-100 text-slate-600",
};
const STATUS_LABEL: Record<ProspectStatus, string> = {
  new: "חדש", approved: "אושר", in_progress: "בטיפול", done: "בוצע", rejected: "נדחה",
};
const STATUS_TABS: { key: ProspectStatus | "all"; label: string; active: string }[] = [
  { key: "all", label: "הכל", active: "bg-brand-600 text-white" },
  { key: "new", label: "חדש", active: "bg-slate-600 text-white" },
  { key: "approved", label: "אושר", active: "bg-emerald-600 text-white" },
  { key: "in_progress", label: "בטיפול", active: "bg-amber-500 text-white" },
  { key: "done", label: "בוצע", active: "bg-teal-600 text-white" },
  { key: "rejected", label: "נדחה", active: "bg-rose-500 text-white" },
];

function gmailCompose(to: string, subject: string, body: string): string {
  const q = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body });
  return `https://mail.google.com/mail/?${q.toString()}`;
}

function OutreachModal({ prospect, onClose }: { prospect: LinkProspect; onClose: () => void }) {
  const draft = useQuery({ queryKey: ["outreach", prospect.id], queryFn: () => api.draftOutreach(prospect.id) });
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (draft.data) { setSubject(draft.data.subject); setBody(draft.data.body); }
  }, [draft.data]);

  const email = prospect.contact && /@/.test(prospect.contact) ? prospect.contact : "";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Mail size={20} className="text-brand-600" /> טיוטת פנייה</h3>
          <button className="text-slate-400 hover:text-slate-700 p-1" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="text-xs text-slate-400 mb-3 truncate">{prospect.title || prospect.url}</div>
        {draft.isLoading ? (
          <div className="text-slate-500 text-sm flex items-center gap-2 py-6"><Loader2 size={16} className="animate-spin" /> קלוד כותב את הפנייה...</div>
        ) : draft.isError ? (
          <div className="text-sm text-rose-600">{(draft.error as any)?.message}</div>
        ) : (
          <>
            <label className="block text-xs text-slate-500 mb-1">נושא</label>
            <input className="input mb-3" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <label className="block text-xs text-slate-500 mb-1">גוף הפנייה</label>
            <textarea className="input" rows={9} value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="flex items-center gap-2 mt-4">
              <a className="btn-primary" href={gmailCompose(email, subject, body)} target="_blank" rel="noreferrer">
                <Mail size={18} /> פתח ב-Gmail
              </a>
              <button className="btn-secondary" onClick={() => { navigator.clipboard.writeText(`${subject}\n\n${body}`); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                {copied ? <Check size={18} /> : <Copy size={18} />} {copied ? "הועתק" : "העתק"}
              </button>
              <div className="flex-1" />
              <button className="btn-secondary" onClick={onClose}>סגור</button>
            </div>
            {!email && <p className="text-xs text-amber-600 mt-2">לא נמצא אימייל להזדמנות זו — הוסף נמען ב-Gmail.</p>}
          </>
        )}
      </div>
    </div>
  );
}

function ProspectCard({ p, onStatus, onPromote, onDelete, onOutreach }: {
  p: LinkProspect;
  onStatus: (id: number, s: ProspectStatus) => void;
  onPromote: (p: LinkProspect) => void;
  onDelete: (id: number) => void;
  onOutreach: (p: LinkProspect) => void;
}) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge ${TYPE_BADGE[p.type]}`}>{TYPE_LABEL[p.type]}</span>
          <span className="badge bg-slate-100 text-slate-600">ניקוד {p.score}</span>
          <span className="badge bg-slate-100 text-slate-500">{STATUS_LABEL[p.status]}</span>
        </div>
        <button className="text-slate-400 hover:text-rose-600 p-1 shrink-0" title="מחק" onClick={() => onDelete(p.id)}><Trash2 size={16} /></button>
      </div>

      <a href={p.url} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline inline-flex items-center gap-1 break-all">
        <ExternalLink size={14} className="shrink-0" /> {p.title || p.url}
      </a>
      {p.reason && <p className="text-sm text-slate-600 mt-1">{p.reason}</p>}
      {p.suggested_action && <p className="text-xs text-slate-500 mt-1"><span className="font-medium">פעולה:</span> {p.suggested_action}</p>}
      {p.contact && <p className="text-xs text-slate-500 mt-0.5"><span className="font-medium">קשר:</span> {p.contact}</p>}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button className="btn-secondary text-sm py-1.5" onClick={() => onOutreach(p)}><Mail size={15} /> הכן פנייה</button>
        <button className="btn-secondary text-sm py-1.5" onClick={() => onPromote(p)} title="הוסף לבנק הקישורים וסמן כבוצע"><ThumbsUp size={15} /> אשר לבנק</button>
        {p.status !== "in_progress" && <button className="btn-secondary text-sm py-1.5" onClick={() => onStatus(p.id, "in_progress")}>בטיפול</button>}
        {p.status !== "rejected" && <button className="text-sm py-1.5 px-3 rounded-lg text-rose-600 hover:bg-rose-50" onClick={() => onStatus(p.id, "rejected")}>דחה</button>}
      </div>
    </div>
  );
}

export default function ProspectsPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ProspectStatus | "all">("all");
  const [outreach, setOutreach] = useState<LinkProspect | null>(null);

  const [polling, setPolling] = useState(false);
  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: prospects, isLoading } = useQuery({
    queryKey: ["prospects", cid],
    queryFn: () => api.listLinkProspects(cid),
    enabled: !!cid,
    refetchInterval: polling ? 12000 : false,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["prospects", cid] });

  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState("");
  useEffect(() => { if (client) setPrefs(client.link_prefs || ""); }, [client]);
  const savePrefs = useMutation({
    mutationFn: () => api.updateClientLinkPrefs(cid, prefs),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["client", cid] }); setShowPrefs(false); },
  });

  const run = useMutation({
    mutationFn: () => api.runLinkProspector(cid),
    onSuccess: () => {
      setPolling(true);
      setTimeout(() => setPolling(false), 210000); // poll ~3.5 min while the agent works
      invalidate();
    },
  });
  const status = useMutation({ mutationFn: ({ id, s }: { id: number; s: ProspectStatus }) => api.setProspectStatus(id, s), onSuccess: invalidate });
  const promote = useMutation({ mutationFn: (p: LinkProspect) => api.promoteProspectToBank(p), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteProspect(id), onSuccess: invalidate });

  const all = prospects || [];
  const counts: Record<string, number> = { all: all.length };
  for (const s of ["new", "approved", "in_progress", "done", "rejected"]) counts[s] = all.filter((p) => p.status === s).length;
  const visible = filter === "all" ? all : all.filter((p) => p.status === filter);

  return (
    <div>
      <PageHeader
        title="איתור קישורים"
        subtitle={client ? `${client.name} · סוכן מחקר שמוצא הזדמנויות קישור (לאישור ידני)` : "סוכן מחקר להזדמנויות קישור"}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setShowPrefs((s) => !s)}><Settings2 size={18} /> העדפות</button>
            <button className="btn-primary" onClick={() => run.mutate()} disabled={run.isPending || polling}>
              {run.isPending || polling ? <Loader2 size={18} className="animate-spin" /> : <Radar size={18} />}
              {polling ? "הסוכן עובד ברקע..." : "הרץ סוכן איתור"}
            </button>
          </>
        }
      />

      <div className="mb-4 text-xs text-slate-500 flex items-center gap-1.5">
        <CalendarClock size={14} /> הסוכן רץ גם אוטומטית כל שבוע (שני 06:00) — גם כשהמחשב כבוי. הזדמנויות חדשות יחכו כאן.
      </div>

      {/* Learning preferences */}
      {showPrefs && (
        <div className="card mb-4 border-brand-200">
          <h3 className="font-semibold text-sm text-slate-800 mb-2 flex items-center gap-2"><Settings2 size={16} /> העדפות לסוכן (למידה)</h3>
          <p className="text-xs text-slate-500 mb-2">הסוכן מכבד את ההעדפות האלה תמיד, בנוסף ללמידה מאישורים/דחיות שלך. לדוגמה: "רק אתרים ישראליים, בלי פורומים, העדף דירקטוריות מקומיות".</p>
          <textarea className="input" rows={3} value={prefs} onChange={(e) => setPrefs(e.target.value)} placeholder="כתוב העדפות..." />
          <div className="flex gap-2 mt-2">
            <button className="btn-primary text-sm py-1.5" onClick={() => savePrefs.mutate()} disabled={savePrefs.isPending}>
              {savePrefs.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} שמור
            </button>
            <button className="btn-secondary text-sm py-1.5" onClick={() => setShowPrefs(false)}>ביטול</button>
          </div>
        </div>
      )}

      {run.isError && <div className="mb-4 text-sm text-rose-600">שגיאה: {(run.error as any)?.message}</div>}
      {polling && (
        <div className="mb-4 bg-brand-50 border border-brand-200 rounded-lg p-3 text-sm text-brand-700 flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" /> הסוכן מחפש באינטרנט ברקע — הזדמנויות חדשות יופיעו כאן מעצמן בתוך דקה-שתיים.
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : all.length === 0 ? (
        <div className="card text-center py-12 text-slate-500">
          <Radar size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-slate-700 font-medium mb-1">אין עדיין הזדמנויות</p>
          <p className="text-sm">לחץ "הרץ סוכן איתור" — קלוד יחפש באינטרנט מקומות רלוונטיים לקישור.</p>
        </div>
      ) : (
        <div className="flex gap-6 items-start">
          <div className="w-36 shrink-0 sticky top-6 flex flex-col gap-1">
            <div className="text-xs text-slate-400 uppercase px-3 mb-1">סטטוס</div>
            {STATUS_TABS.map((t) => (
              <button key={t.key} onClick={() => setFilter(t.key)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${filter === t.key ? t.active : "text-slate-600 hover:bg-slate-100"}`}>
                <span>{t.label}</span>
                <span className={`text-xs rounded-full px-1.5 py-0.5 ${filter === t.key ? "bg-white/25" : "bg-slate-100 text-slate-500"}`}>{counts[t.key]}</span>
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-0 space-y-4">
            {visible.length === 0 ? (
              <div className="card text-center py-10 text-slate-400 text-sm">אין הזדמנויות בסטטוס הזה.</div>
            ) : (
              visible.map((p) => (
                <ProspectCard key={p.id} p={p}
                  onStatus={(id, s) => status.mutate({ id, s })}
                  onPromote={(pr) => promote.mutate(pr)}
                  onDelete={(id) => { if (confirm("למחוק את ההזדמנות?")) remove.mutate(id); }}
                  onOutreach={(pr) => setOutreach(pr)}
                />
              ))
            )}
          </div>
        </div>
      )}

      {outreach && <OutreachModal prospect={outreach} onClose={() => setOutreach(null)} />}
    </div>
  );
}
