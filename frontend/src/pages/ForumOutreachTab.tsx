import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MessagesSquare, Loader2, ExternalLink, Trash2, Check, Copy, Plus, Pencil, Save, X,
  Settings2, CalendarClock, ChevronDown, ChevronUp,
} from "lucide-react";
import * as api from "../api";
import type { ForumSite, ForumLead, ProspectStatus } from "../api";
import Spinner from "../components/Spinner";

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

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="btn-secondary text-xs py-1 px-2" onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "הועתק" : label}
    </button>
  );
}

/* ---------------- Sites manager ---------------- */
function SitesManager({ cid }: { cid: number }) {
  const qc = useQueryClient();
  const { data: sites, isLoading } = useQuery({ queryKey: ["forum-sites", cid], queryFn: () => api.listForumSites(cid), enabled: !!cid });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["forum-sites", cid] });

  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ url: string; name: string; max_pages: number; max_threads: number }>({ url: "", name: "", max_pages: 3, max_threads: 5 });

  const add = useMutation({
    mutationFn: () => api.createForumSite(cid, { url: url.trim(), name: name.trim() || null }),
    onSuccess: () => { setUrl(""); setName(""); invalidate(); },
  });
  const save = useMutation({ mutationFn: () => api.updateForumSite(editId!, edit), onSuccess: () => { setEditId(null); invalidate(); } });
  const toggle = useMutation({ mutationFn: (s: ForumSite) => api.updateForumSite(s.id, { active: !s.active }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteForumSite(id), onSuccess: invalidate });

  const [discUrl, setDiscUrl] = useState("");
  const discover = useMutation({
    mutationFn: () => api.discoverSubforums(cid, discUrl.trim(), true),
    onSuccess: () => { setDiscUrl(""); invalidate(); },
  });

  return (
    <div className="card mb-6">
      <h3 className="font-semibold flex items-center gap-2 text-slate-800 mb-3"><Settings2 size={18} className="text-brand-600" /> אתרים / פורומים לסריקה</h3>

      <div className="flex flex-wrap gap-2 mb-3">
        <input className="input flex-1 min-w-[260px]" placeholder="כתובת פורום ספציפי (https://...)" value={url}
          onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && url.trim()) add.mutate(); }} />
        <input className="input w-48" placeholder="שם (אופציונלי)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary shrink-0" onClick={() => add.mutate()} disabled={add.isPending || !url.trim()}>
          {add.isPending ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />} הוסף
        </button>
      </div>
      {add.isError && <div className="text-sm text-rose-600 mb-2">{(add.error as any)?.message}</div>}

      {/* Auto-discover sub-forums from a parent board (e.g. a Prog index page) */}
      <div className="bg-slate-50 rounded-lg p-3 mb-4">
        <div className="text-xs text-slate-600 mb-2">סיווג אוטומטי: הדבק כתובת של עמוד פורום ראשי (שמכיל קישורים לתת-פורומים), והמערכת תזהה את כל תת-הפורומים ותוסיף אותם בנפרד.</div>
        <div className="flex flex-wrap gap-2">
          <input className="input flex-1 min-w-[260px]" placeholder="כתובת פורום ראשי לגילוי תת-פורומים (https://...)" value={discUrl}
            onChange={(e) => setDiscUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && discUrl.trim()) discover.mutate(); }} />
          <button className="btn-secondary shrink-0" onClick={() => discover.mutate()} disabled={discover.isPending || !discUrl.trim()}>
            {discover.isPending ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />} גלה והוסף תת-פורומים
          </button>
        </div>
        {discover.isError && <div className="text-sm text-rose-600 mt-2">{(discover.error as any)?.message}</div>}
        {discover.isSuccess && (
          <div className="text-sm text-emerald-700 mt-2">
            {discover.data.added > 0 ? `נוספו ${discover.data.added} תת-פורומים.` : (discover.data.note || `נמצאו ${discover.data.found.length} — כולם כבר קיימים.`)}
          </div>
        )}
      </div>

      {isLoading ? <Spinner /> : (sites || []).length === 0 ? (
        <p className="text-slate-400 text-sm">עדיין לא הוזנו אתרים. הוסף פורומים שבהם אתם רשומים ופעילים.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {(sites || []).map((s) => editId === s.id ? (
            <li key={s.id} className="py-3 flex flex-col gap-2">
              <input className="input" value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} />
              <div className="flex flex-wrap gap-2 items-center">
                <input className="input w-48" placeholder="שם" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                <label className="text-xs text-slate-500">עמודי רשימה
                  <input type="number" min={1} max={10} className="input w-16 mr-1" value={edit.max_pages} onChange={(e) => setEdit({ ...edit, max_pages: +e.target.value })} />
                </label>
                <label className="text-xs text-slate-500">אשכולות לפתוח
                  <input type="number" min={1} max={15} className="input w-16 mr-1" value={edit.max_threads} onChange={(e) => setEdit({ ...edit, max_threads: +e.target.value })} />
                </label>
                <button className="btn-primary text-sm py-1.5" onClick={() => save.mutate()} disabled={save.isPending}><Save size={15} /> שמור</button>
                <button className="btn-secondary text-sm py-1.5" onClick={() => setEditId(null)}><X size={15} /> ביטול</button>
              </div>
            </li>
          ) : (
            <li key={s.id} className="py-3 flex items-center gap-3">
              <button className={`w-9 h-5 rounded-full shrink-0 relative transition-colors ${s.active ? "bg-brand-600" : "bg-slate-300"}`} title={s.active ? "פעיל" : "כבוי"} onClick={() => toggle.mutate(s)}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${s.active ? "right-0.5" : "right-4"}`} />
              </button>
              <div className="flex-1 min-w-0">
                <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline inline-flex items-center gap-1 break-all">
                  <ExternalLink size={13} className="shrink-0" /> {s.name || s.url}
                </a>
                <div className="text-xs text-slate-400">
                  {s.max_pages} עמודי רשימה · {s.max_threads} אשכולות · {s.last_scanned_at ? `נסרק ${new Date(s.last_scanned_at).toLocaleDateString("he-IL")}` : "טרם נסרק"}
                </div>
                {s.last_scan_note && (
                  <div className={`text-xs mt-0.5 ${(s.last_scan_found || 0) > 0 ? "text-emerald-600" : "text-amber-600"}`}>↳ {s.last_scan_note}</div>
                )}
              </div>
              <button className="text-slate-400 hover:text-brand-600 p-1 shrink-0" title="ערוך" onClick={() => { setEditId(s.id); setEdit({ url: s.url, name: s.name || "", max_pages: s.max_pages, max_threads: s.max_threads }); }}><Pencil size={15} /></button>
              <button className="text-slate-400 hover:text-rose-600 p-1 shrink-0" title="מחק" onClick={() => { if (confirm("למחוק את האתר?")) remove.mutate(s.id); }}><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- Lead card ---------------- */
function LeadCard({ lead, forumName, onStatus, onSave, onDelete }: {
  lead: ForumLead;
  forumName?: string;
  onStatus: (id: number, s: ProspectStatus) => void;
  onSave: (id: number, body: { suggested_reply: string; target_url: string }) => void;
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState(lead.suggested_reply || "");
  const [target, setTarget] = useState(lead.target_url || "");
  useEffect(() => { setReply(lead.suggested_reply || ""); setTarget(lead.target_url || ""); }, [lead.id]);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="badge bg-amber-50 text-amber-700">{forumName || "פורום"}</span>
          <span className="badge bg-slate-100 text-slate-600">ניקוד {lead.score}</span>
          <span className="badge bg-slate-100 text-slate-500">{STATUS_LABEL[lead.status]}</span>
        </div>
        <button className="text-slate-400 hover:text-rose-600 p-1 shrink-0" title="מחק" onClick={() => onDelete(lead.id)}><Trash2 size={16} /></button>
      </div>

      <a href={lead.thread_url} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline inline-flex items-center gap-1 break-all mt-2">
        <ExternalLink size={14} className="shrink-0" /> {lead.thread_title || lead.thread_url}
      </a>

      <button className="mt-2 text-sm text-slate-500 hover:text-slate-700 inline-flex items-center gap-1" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />} {open ? "הסתר פרטים" : "הצג שאלה ותגובה מוצעת"}
      </button>

      {open && (
        <div className="mt-3 space-y-3 text-sm">
          {lead.question && (
            <div>
              <div className="font-semibold text-slate-800 mb-1">השאלה של הגולש</div>
              <p className="text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3">{lead.question}</p>
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-slate-800">תגובה מוצעת</span>
              {!editing ? (
                <div className="flex gap-1.5">
                  {reply && <CopyBtn text={reply} label="העתק תגובה" />}
                  <button className="btn-secondary text-xs py-1 px-2" onClick={() => setEditing(true)}><Pencil size={13} /> ערוך</button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <button className="btn-primary text-xs py-1 px-2" onClick={() => { onSave(lead.id, { suggested_reply: reply, target_url: target }); setEditing(false); }}><Save size={13} /> שמור</button>
                  <button className="text-xs py-1 px-2 rounded text-slate-500 hover:bg-slate-100" onClick={() => { setReply(lead.suggested_reply || ""); setTarget(lead.target_url || ""); setEditing(false); }}>ביטול</button>
                </div>
              )}
            </div>
            {editing ? (
              <textarea className="input" rows={6} value={reply} onChange={(e) => setReply(e.target.value)} />
            ) : (
              <p className="text-slate-700 whitespace-pre-wrap bg-emerald-50/60 rounded-lg p-3">{reply || "—"}</p>
            )}
          </div>
          <div>
            <div className="font-semibold text-slate-800 mb-1">קישור לאתר העסק</div>
            {editing ? (
              <input className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="https://..." />
            ) : target ? (
              <a href={target} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline break-all inline-flex items-center gap-1"><ExternalLink size={13} /> {target}</a>
            ) : <span className="text-slate-400">—</span>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        {lead.status !== "done" && <button className="btn-secondary text-sm py-1.5" onClick={() => onStatus(lead.id, "done")}><Check size={15} /> סמן כבוצע</button>}
        {lead.status !== "in_progress" && <button className="btn-secondary text-sm py-1.5" onClick={() => onStatus(lead.id, "in_progress")}>בטיפול</button>}
        {lead.status !== "rejected" && <button className="text-sm py-1.5 px-3 rounded-lg text-rose-600 hover:bg-rose-50" onClick={() => onStatus(lead.id, "rejected")}>דחה</button>}
      </div>
    </div>
  );
}

/* ---------------- Main tab ---------------- */
export default function ForumOutreachTab({ cid, client }: { cid: number; client?: api.Client | null }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ProspectStatus | "all">("all");
  const [forumFilter, setForumFilter] = useState<number | "all">("all");
  const [polling, setPolling] = useState(false);

  const { data: leads, isLoading } = useQuery({
    queryKey: ["forum-leads", cid],
    queryFn: () => api.listForumLeads(cid),
    enabled: !!cid,
    refetchInterval: polling ? 12000 : false,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["forum-leads", cid] });

  const { data: sites } = useQuery({ queryKey: ["forum-sites", cid], queryFn: () => api.listForumSites(cid), enabled: !!cid, refetchInterval: polling ? 12000 : false });
  const activeCount = (sites || []).filter((s) => s.active).length;
  const siteName = (id: number | null) => (sites || []).find((s) => s.id === id)?.name || (sites || []).find((s) => s.id === id)?.url || "פורום";

  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState("");
  useEffect(() => { if (client) setPrefs(client.forum_prefs || ""); }, [client]);
  const savePrefs = useMutation({
    mutationFn: () => api.updateClientForumPrefs(cid, prefs),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["client", cid] }); setShowPrefs(false); },
  });

  const scan = useMutation({
    mutationFn: () => api.runForumScan(cid),
    onSuccess: () => { setPolling(true); setTimeout(() => setPolling(false), 240000); invalidate(); },
  });
  const status = useMutation({ mutationFn: ({ id, s }: { id: number; s: ProspectStatus }) => api.setForumLeadStatus(id, s), onSuccess: invalidate });
  const saveLead = useMutation({ mutationFn: ({ id, body }: { id: number; body: any }) => api.updateForumLead(id, body), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteForumLead(id), onSuccess: invalidate });

  const all = leads || [];
  const byForum = forumFilter === "all" ? all : all.filter((l) => l.forum_site_id === forumFilter);
  const counts: Record<string, number> = { all: byForum.length };
  for (const s of ["new", "approved", "in_progress", "done", "rejected"]) counts[s] = byForum.filter((l) => l.status === s).length;
  const visible = filter === "all" ? byForum : byForum.filter((l) => l.status === filter);
  const forumsWithLeads = (sites || []).filter((s) => all.some((l) => l.forum_site_id === s.id));

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <p className="text-sm text-slate-500 flex items-center gap-1.5">
          <CalendarClock size={14} /> הרצה ידנית בלבד. הסורק קורא כותרות אשכולות, נכנס לשאלות הרלוונטיות, ומכין תגובה + קישור.
        </p>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setShowPrefs((s) => !s)}><Settings2 size={18} /> הנחיות לסוכן</button>
          <button className="btn-primary" onClick={() => scan.mutate()} disabled={scan.isPending || polling || activeCount === 0}
            title={activeCount === 0 ? "הוסף אתר פעיל תחילה" : ""}>
            {scan.isPending || polling ? <Loader2 size={18} className="animate-spin" /> : <MessagesSquare size={18} />}
            {polling ? "סורק ברקע..." : "סרוק פורומים"}
          </button>
        </div>
      </div>

      {showPrefs && (
        <div className="card mb-4 border-brand-200">
          <h3 className="font-semibold text-sm text-slate-800 mb-2 flex items-center gap-2"><Settings2 size={16} /> הנחיות קבועות לסוכן הפורומים</h3>
          <p className="text-xs text-slate-500 mb-2">למשל: "טון חברי ולא שיווקי, תמיד תן קודם ערך אמיתי, קשר רק כשזה באמת רלוונטי, העדף לקשר לעמודי השירות".</p>
          <textarea className="input" rows={3} value={prefs} onChange={(e) => setPrefs(e.target.value)} placeholder="כתוב הנחיות..." />
          <div className="flex gap-2 mt-2">
            <button className="btn-primary text-sm py-1.5" onClick={() => savePrefs.mutate()} disabled={savePrefs.isPending}>
              {savePrefs.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} שמור
            </button>
            <button className="btn-secondary text-sm py-1.5" onClick={() => setShowPrefs(false)}>ביטול</button>
          </div>
        </div>
      )}

      <SitesManager cid={cid} />

      {scan.isError && <div className="mb-4 text-sm text-rose-600">שגיאה: {(scan.error as any)?.message}</div>}
      {polling && (
        <div className="mb-4 bg-brand-50 border border-brand-200 rounded-lg p-3 text-sm text-brand-700 flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" /> הסוכן קורא את הפורומים ומכין תגובות ברקע — הזדמנויות חדשות יופיעו כאן מעצמן.
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : all.length === 0 ? (
        <div className="card text-center py-12 text-slate-500">
          <MessagesSquare size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-slate-700 font-medium mb-1">אין עדיין הזדמנויות מפורומים</p>
          <p className="text-sm">הוסף אתרים למעלה ולחץ "סרוק פורומים".</p>
        </div>
      ) : (
        <div className="flex gap-6 items-start">
          <div className="w-44 shrink-0 sticky top-6 flex flex-col gap-1">
            {forumsWithLeads.length > 1 && (
              <div className="mb-3">
                <div className="text-xs text-slate-400 uppercase px-3 mb-1">פורום</div>
                <select className="input text-sm py-1.5" value={String(forumFilter)}
                  onChange={(e) => setForumFilter(e.target.value === "all" ? "all" : Number(e.target.value))}>
                  <option value="all">כל הפורומים</option>
                  {forumsWithLeads.map((s) => <option key={s.id} value={s.id}>{s.name || s.url}</option>)}
                </select>
              </div>
            )}
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
              visible.map((l) => (
                <LeadCard key={l.id} lead={l} forumName={siteName(l.forum_site_id)}
                  onStatus={(id, s) => status.mutate({ id, s })}
                  onSave={(id, body) => saveLead.mutate({ id, body })}
                  onDelete={(id) => { if (confirm("למחוק את ההזדמנות?")) remove.mutate(id); }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
