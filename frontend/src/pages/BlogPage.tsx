import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Newspaper, Loader2, Plug, Check, ExternalLink, Trash2, Send, CalendarClock, AlertTriangle, Save, Lightbulb, X, Pencil, MessageCircle, Link2, Plus } from "lucide-react";
import * as api from "../api";
import type { BlogPost } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import TaskAssistant, { AssistantFab } from "./TaskAssistant";
import type { AssistantSeed } from "./TaskAssistant";

function ConnectForm({ clientId, onDone }: { clientId: number; onDone: () => void }) {
  const [siteUrl, setSiteUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [mode, setMode] = useState<"publish" | "draft">("publish");
  const connect = useMutation({
    mutationFn: () => api.connectWordpress(clientId, { site_url: siteUrl, username, app_password: appPassword, mode }),
    onSuccess: onDone,
  });
  const canSubmit = siteUrl.trim() && username.trim() && appPassword.trim() && !connect.isPending;
  return (
    <div className="card max-w-xl">
      <h3 className="font-semibold flex items-center gap-2 text-slate-800 mb-2"><Plug size={18} className="text-brand-600" /> חיבור WordPress</h3>
      <p className="text-xs text-slate-500 mb-4">
        צור "סיסמת יישום" ב-WordPress: <span className="text-slate-600">משתמשים → הפרופיל שלי → Application Passwords</span> → צור סיסמה חדשה → העתק והדבק כאן.
      </p>
      <div className="flex flex-col gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">כתובת האתר</label>
          <input className="input" placeholder="https://example.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">שם משתמש (WordPress)</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">סיסמת יישום</label>
            <input className="input" type="password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} placeholder="xxxx xxxx xxxx xxxx" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">מצב פרסום</label>
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="publish">פרסום אוטומטי מלא (live)</option>
            <option value="draft">טיוטה לאישור</option>
          </select>
        </div>
        <button className="btn-primary" onClick={() => connect.mutate()} disabled={!canSubmit}>
          {connect.isPending ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} בדוק ושמור חיבור
        </button>
        {connect.isError && <div className="text-sm text-rose-600">{(connect.error as any)?.message}</div>}
      </div>
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  publish: "bg-emerald-50 text-emerald-700", draft: "bg-amber-50 text-amber-700", error: "bg-rose-50 text-rose-700", done: "bg-emerald-50 text-emerald-700",
};
const STATUS_LABEL: Record<string, string> = { publish: "פורסם", draft: "טיוטה", error: "שגיאה", done: "בוצע" };

function ProposalCard({ cid, p, client }: { cid: number; p: BlogPost; client?: { name?: string; domain?: string } | null }) {
  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["wp", cid] }); qc.invalidateQueries({ queryKey: ["blog-posts", cid] }); };
  const [modOpen, setModOpen] = useState(false);
  const [modText, setModText] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSeed, setChatSeed] = useState<AssistantSeed | null>(null);
  const [srcOpen, setSrcOpen] = useState(false);
  const [srcList, setSrcList] = useState<string[]>(p.sources && p.sources.length ? p.sources : [""]);
  const cleanSources = srcList.map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));

  const approve = useMutation({ mutationFn: (mod?: string) => api.approveBlogProposal(p.id, mod), onSuccess: invalidate });
  const reject = useMutation({ mutationFn: () => api.rejectBlogProposal(p.id), onSuccess: invalidate });
  const markDone = useMutation({ mutationFn: () => api.setBlogPostDone(p.id), onSuccess: invalidate });
  const sample = useMutation({ mutationFn: () => api.sampleBlog(cid, p.keyword || undefined, cleanSources, modOpen ? modText.trim() : undefined) });
  const saveSources = useMutation({ mutationFn: () => api.setBlogProposalSources(p.id, cleanSources), onSuccess: invalidate });
  const savedCount = (p.sources || []).length;

  const ask = () => {
    setChatSeed({ title: "התייעצות על הצעת מאמר", nonce: Date.now(), context: `התייעצות על הצעת מאמר לבלוג של ${client?.name || "הלקוח"} (${client?.domain || ""}).\nכותרת מוצעת: ${p.title}\nמילת מפתח: ${p.keyword || "—"}\nנימוק: ${p.reason || "—"}` });
    setChatOpen(true);
  };

  return (
    <li className="border border-slate-200 rounded-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-slate-900">{p.title}</div>
          {p.keyword && <div className="text-xs text-slate-400">מילת מפתח: {p.keyword}</div>}
        </div>
        <span className="text-xs text-slate-400 shrink-0 flex items-center gap-1"><CalendarClock size={12} /> {new Date(p.created_at).toLocaleString("he-IL")}</span>
      </div>
      {p.reason && <div className="text-sm text-slate-600 whitespace-pre-wrap mt-1">{p.reason}</div>}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button className="btn-secondary text-sm py-1.5" onClick={() => sample.mutate()} disabled={sample.isPending}>
          {sample.isPending ? <Loader2 size={15} className="animate-spin" /> : <Newspaper size={15} />} צור דוגמה
        </button>
        <button className="btn-primary text-sm py-1.5" onClick={() => approve.mutate(undefined)} disabled={approve.isPending}>
          {approve.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {approve.isPending ? "כותב ומפרסם..." : "בצע (כתוב ופרסם)"}
        </button>
        <button className="btn-secondary text-sm py-1.5" onClick={() => setModOpen((o) => !o)}><Pencil size={15} /> בצע עם שינוי</button>
        <button className={`btn-secondary text-sm py-1.5 ${savedCount ? "text-brand-700 border-brand-200 bg-brand-50" : ""}`} onClick={() => setSrcOpen((o) => !o)}>
          <Link2 size={15} /> הוספת מקורות{savedCount ? ` (${savedCount})` : ""}
        </button>
        <button className={`btn-secondary text-sm py-1.5 ${markDone.isSuccess ? "text-emerald-700 border-emerald-200 bg-emerald-50" : ""}`} onClick={() => markDone.mutate()} disabled={markDone.isPending || markDone.isSuccess}>
          {markDone.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} className={markDone.isSuccess ? "text-emerald-600" : ""} />} בוצע
        </button>
        <button className="text-sm py-1.5 px-3 rounded-lg text-brand-600 hover:bg-brand-50 inline-flex items-center gap-1" onClick={ask}><MessageCircle size={15} /> שאל</button>
        <button className="text-sm py-1.5 px-3 rounded-lg text-slate-500 hover:bg-slate-100 inline-flex items-center gap-1" onClick={() => reject.mutate()} disabled={reject.isPending}><X size={15} /> התעלם</button>
      </div>

      {modOpen && (
        <div className="mt-2">
          <textarea className="input" rows={2} placeholder="מה לשנות/להוסיף בכתיבה (למשל: טון שיווקי יותר, הוסף קריאה לפעולה, התמקד באזור X, מאמר קצר יותר)" value={modText} onChange={(e) => setModText(e.target.value)} />
          <button className="btn-primary text-sm py-1.5 mt-2" onClick={() => approve.mutate(modText.trim() || undefined)} disabled={approve.isPending || !modText.trim()}>
            {approve.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} כתוב עם השינוי
          </button>
        </div>
      )}

      {srcOpen && (
        <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-2">הדבק כתובות URL של מקורות מהאינטרנט. המערכת תקרא כל מקור ותתבסס עליו — "צור דוגמה"/"בצע" יפיקו מאמר מקיף ואיכותי ששואב רעיונות וטקסטים מהמקורות (אלא אם ביקשת ב"בצע עם שינוי" מאמר קצר יותר).</p>
          {srcList.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 mb-1.5">
              <input className="input flex-1 text-sm py-1" placeholder="https://..." value={s}
                onChange={(e) => setSrcList((l) => l.map((v, idx) => idx === i ? e.target.value : v))} />
              <button className="text-slate-400 hover:text-rose-600 p-1 shrink-0" title="הסר" onClick={() => setSrcList((l) => l.length > 1 ? l.filter((_, idx) => idx !== i) : [""])}><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-1">
            <button className="btn-secondary text-sm py-1" onClick={() => setSrcList((l) => [...l, ""])}><Plus size={14} /> עוד מקור</button>
            <button className="btn-primary text-sm py-1" onClick={() => saveSources.mutate()} disabled={saveSources.isPending}>
              {saveSources.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} שמור מקורות
            </button>
            {saveSources.isSuccess && <span className="text-sm text-emerald-600">נשמר ✓</span>}
            {saveSources.isError && <span className="text-sm text-rose-600">{(saveSources.error as any)?.message}</span>}
          </div>
        </div>
      )}

      {sample.isError && <div className="text-sm text-rose-600 mt-2">{(sample.error as any)?.message}</div>}
      {sample.data && (
        <div className="mt-3 border border-slate-200 rounded-lg p-3 bg-slate-50">
          <div className="font-semibold text-slate-900">{sample.data.title}</div>
          {sample.data.keyword && <div className="text-xs text-slate-400 mb-1">מילת מפתח: {sample.data.keyword}</div>}
          <div className="text-sm text-slate-700 whitespace-pre-wrap">{sample.data.preview || "—"}</div>
        </div>
      )}
      {approve.isError && <div className="text-sm text-rose-600 mt-2">{(approve.error as any)?.message}</div>}

      <TaskAssistant cid={cid} open={chatOpen} onClose={() => setChatOpen(false)} seed={chatSeed} />
    </li>
  );
}

export default function BlogPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: wp, isLoading } = useQuery({ queryKey: ["wp", cid], queryFn: () => api.getWordpress(cid), enabled: !!cid });
  const { data: posts } = useQuery({ queryKey: ["blog-posts", cid], queryFn: () => api.listBlogPosts(cid), enabled: !!cid });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["wp", cid] }); qc.invalidateQueries({ queryKey: ["blog-posts", cid] }); };

  const settings = useMutation({ mutationFn: (p: { mode?: "publish" | "draft"; enabled?: boolean; require_approval?: boolean; blog_instructions?: string; bridge_secret?: string; bridge_enabled?: boolean }) => api.updateWordpressSettings(cid, p), onSuccess: () => qc.invalidateQueries({ queryKey: ["wp", cid] }) });
  const disconnect = useMutation({ mutationFn: () => api.disconnectWordpress(cid), onSuccess: invalidate });
  const publishNow = useMutation({ mutationFn: () => api.publishBlogNow(cid), onSuccess: invalidate });
  const propose = useMutation({ mutationFn: () => api.proposeBlog(cid), onSuccess: invalidate });

  const [bridgeSecret, setBridgeSecret] = useState("");
  const [historyMonth, setHistoryMonth] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSeed, setChatSeed] = useState<AssistantSeed | null>(null);
  const askContent = () => { setChatSeed({ title: "כתיבת תוכן לבלוג", nonce: Date.now(), context: `התייעצות על כתיבת תוכן/מאמרים לבלוג של ${client?.name || "הלקוח"} (${client?.domain || ""}). נושאים: רעיונות למאמרים, מבנה, טון, מילות מפתח, שיפור טיוטות.` }); setChatOpen(true); };

  return (
    <div>
      <PageHeader title="בלוג אוטומטי" subtitle={client ? `${client.name} · מאמר SEO חדש כל שבוע ל-WordPress` : "בלוג אוטומטי"} />

      {isLoading ? (
        <Spinner />
      ) : !wp ? (
        <ConnectForm clientId={cid} onDone={invalidate} />
      ) : (
        <>
          {/* Connection status */}
          <div className="card mb-6">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <h3 className="font-semibold flex items-center gap-2 text-slate-800">
                <Plug size={18} className="text-emerald-600" /> מחובר: <a href={wp.site_url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{wp.site_url}</a>
              </h3>
              <div className="flex items-center gap-2">
                {wp.require_approval ? (
                  <button className="btn-primary" onClick={() => propose.mutate()} disabled={propose.isPending}>
                    {propose.isPending ? <Loader2 size={18} className="animate-spin" /> : <Lightbulb size={18} />}
                    {propose.isPending ? "מכין הצעה..." : "הצע נושא"}
                  </button>
                ) : (
                  <button className="btn-primary" onClick={() => publishNow.mutate()} disabled={publishNow.isPending}>
                    {publishNow.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                    {publishNow.isPending ? "כותב ומפרסם..." : "כתוב ופרסם עכשיו"}
                  </button>
                )}
                <button className="btn-secondary" onClick={() => { if (confirm("לנתק את WordPress?")) disconnect.mutate(); }}><Trash2 size={16} /> נתק</button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={wp.enabled} className="h-4 w-4 accent-brand-600" onChange={(e) => settings.mutate({ enabled: e.target.checked })} />
                <span className="text-slate-700">אוטומציה שבועית פעילה</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={wp.require_approval} className="h-4 w-4 accent-brand-600" onChange={(e) => settings.mutate({ require_approval: e.target.checked })} />
                <span className="text-slate-700">דרוש אישור לפני כתיבה (חצי-אוטומטי)</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">מצב פרסום:</span>
                <select className="input py-1 text-sm w-40" value={wp.mode} onChange={(e) => settings.mutate({ mode: e.target.value as any })}>
                  <option value="publish">פרסום מלא (live)</option>
                  <option value="draft">טיוטה לאישור</option>
                </select>
              </div>
              {wp.last_published_at && <span className="text-xs text-slate-400">פורסם לאחרונה: {new Date(wp.last_published_at).toLocaleString("he-IL")}</span>}
            </div>
            <div className="mt-3 text-xs text-slate-500 flex items-center gap-1.5">
              <CalendarClock size={14} /> {wp.require_approval
                ? "כל יום שני הסוכן יציע נושא חדש (מבוסס ZEFO/GSC) שיחכה לאישורך כאן — גם כשהמחשב כבוי."
                : "מאמר חדש עולה אוטומטית כל יום שני, מבוסס על הזדמנויות ה-SEO — גם כשהמחשב כבוי."}
            </div>
            {!wp.require_approval && wp.mode === "publish" && (
              <div className="mt-2 text-xs text-amber-600 flex items-center gap-1.5">
                <AlertTriangle size={14} /> אוטומטי מלא + "פרסום מלא": המאמר נכתב ועולה חי בלי בדיקה.
              </div>
            )}
            {propose.isError && <div className="mt-3 text-sm text-rose-600">{(propose.error as any)?.message}</div>}
            {publishNow.isError && <div className="mt-3 text-sm text-rose-600">{(publishNow.error as any)?.message}</div>}
            {publishNow.isSuccess && (
              <div className="mt-3 text-sm text-emerald-700">
                נוצר: "{(publishNow.data as any).title}" (מילה: {(publishNow.data as any).keyword}) — <a href={(publishNow.data as any).url} target="_blank" rel="noreferrer" className="underline">צפה</a>
              </div>
            )}
          </div>

          {/* SEO Dash Bridge — advanced edits (manual only) */}
          <div className="card mb-6">
            <h3 className="font-semibold flex items-center gap-2 text-slate-800 mb-1"><Plug size={18} className="text-brand-600" /> גשר SEO Dash (עריכות מתקדמות)</h3>
            <p className="text-xs text-slate-500 mb-3">
              מאפשר לדאשבורד לערוך תוכן Elementor, תיאורי מטא ו-CSS דרך תוסף הגשר באתר — <span className="font-medium">רק כשתלחץ "קבל ויישם" על תיקון. אין שום פעולה אוטומטית.</span>{" "}
              <span className={wp.bridge_enabled ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>{wp.bridge_enabled ? "מצב: פעיל" : "מצב: לא מוגדר"}</span>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input className="input flex-1 min-w-[260px]" type="password"
                placeholder={wp.bridge_enabled ? "מפתח מוגדר — הדבק כדי להחליף" : "הדבק מפתח סודי (הגדרות וורדפרס → SEO Dash Bridge)"}
                value={bridgeSecret} onChange={(e) => setBridgeSecret(e.target.value)} />
              <button className="btn-primary" disabled={!bridgeSecret.trim() || settings.isPending}
                onClick={() => { settings.mutate({ bridge_secret: bridgeSecret.trim(), bridge_enabled: true }); setBridgeSecret(""); }}>
                <Save size={16} /> שמור מפתח והפעל
              </button>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={wp.bridge_enabled} className="h-4 w-4 accent-brand-600" onChange={(e) => settings.mutate({ bridge_enabled: e.target.checked })} />
                <span className="text-slate-700">גשר פעיל</span>
              </label>
            </div>
          </div>

          {/* Pending proposals */}
          {(posts || []).some((p) => p.status === "proposed") && (
            <div className="card mb-6 border-r-4 border-r-brand-400">
              <h3 className="font-semibold flex items-center gap-2 text-slate-800 mb-3"><Lightbulb size={18} className="text-brand-600" /> הצעות ממתינות לאישור</h3>
              <ul className="space-y-3">
                {(posts || []).filter((p) => p.status === "proposed").map((p: BlogPost) => (
                  <ProposalCard key={p.id} cid={cid} p={p} client={client} />
                ))}
              </ul>
            </div>
          )}

          {/* History */}
          {(() => {
            const history = (posts || []).filter((p) => ["publish", "draft", "error", "done"].includes(p.status || ""));
            const months = [...new Set(history.map((p) => (p.created_at || "").slice(0, 7)).filter(Boolean))].sort().reverse();
            const monthLabel = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("he-IL", { month: "long", year: "numeric" });
            const shown = historyMonth ? history.filter((p) => (p.created_at || "").slice(0, 7) === historyMonth) : history;
            return (
          <div className="card">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h3 className="font-semibold flex items-center gap-2 text-slate-800"><Newspaper size={18} /> היסטוריית מאמרים</h3>
              {months.length > 0 && (
                <select className="input py-1 text-sm w-auto" value={historyMonth} onChange={(e) => setHistoryMonth(e.target.value)}>
                  <option value="">כל החודשים</option>
                  {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
              )}
            </div>
            {history.length === 0 ? (
              <p className="text-slate-400 text-sm">עדיין לא פורסמו מאמרים. {wp.require_approval ? 'לחץ "הצע נושא" לקבלת הצעה' : 'לחץ "כתוב ופרסם עכשיו"'} או המתן לריצה השבועית.</p>
            ) : shown.length === 0 ? (
              <p className="text-slate-400 text-sm">אין מאמרים בחודש שנבחר.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {shown.map((p: BlogPost) => (
                  <li key={p.id} className="py-3 flex items-start gap-3">
                    <span className={`badge ${STATUS_BADGE[p.status || ""] || "bg-slate-100 text-slate-600"} shrink-0 mt-0.5`}>{STATUS_LABEL[p.status || ""] || p.status}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900">{p.title}</div>
                      <div className="text-xs text-slate-400">
                        {p.keyword && <>מילה: {p.keyword} · </>}{new Date(p.created_at).toLocaleString("he-IL")}
                      </div>
                      {p.error && <div className="text-xs text-rose-600 mt-0.5 break-words">{p.error}</div>}
                    </div>
                    {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline text-sm inline-flex items-center gap-1 shrink-0"><ExternalLink size={13} /> צפה</a>}
                  </li>
                ))}
              </ul>
            )}
          </div>
            );
          })()}

          <AssistantFab onClick={askContent} />
          <TaskAssistant cid={cid} open={chatOpen} onClose={() => setChatOpen(false)} seed={chatSeed} />
        </>
      )}
    </div>
  );
}
