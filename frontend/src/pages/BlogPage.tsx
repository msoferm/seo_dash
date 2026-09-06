import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Newspaper, Loader2, Plug, Check, ExternalLink, Trash2, Send, CalendarClock, AlertTriangle, GraduationCap, Save } from "lucide-react";
import * as api from "../api";
import type { BlogPost } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

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
  publish: "bg-emerald-50 text-emerald-700", draft: "bg-amber-50 text-amber-700", error: "bg-rose-50 text-rose-700",
};
const STATUS_LABEL: Record<string, string> = { publish: "פורסם", draft: "טיוטה", error: "שגיאה" };

export default function BlogPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: wp, isLoading } = useQuery({ queryKey: ["wp", cid], queryFn: () => api.getWordpress(cid), enabled: !!cid });
  const { data: posts } = useQuery({ queryKey: ["blog-posts", cid], queryFn: () => api.listBlogPosts(cid), enabled: !!cid });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["wp", cid] }); qc.invalidateQueries({ queryKey: ["blog-posts", cid] }); };

  const settings = useMutation({ mutationFn: (p: { mode?: "publish" | "draft"; enabled?: boolean; blog_instructions?: string }) => api.updateWordpressSettings(cid, p), onSuccess: () => qc.invalidateQueries({ queryKey: ["wp", cid] }) });
  const disconnect = useMutation({ mutationFn: () => api.disconnectWordpress(cid), onSuccess: invalidate });
  const publishNow = useMutation({ mutationFn: () => api.publishBlogNow(cid), onSuccess: invalidate });

  const [instructions, setInstructions] = useState("");
  useEffect(() => { if (wp) setInstructions(wp.blog_instructions || ""); }, [wp]);
  const saveInstructions = useMutation({ mutationFn: () => api.updateWordpressSettings(cid, { blog_instructions: instructions }), onSuccess: () => qc.invalidateQueries({ queryKey: ["wp", cid] }) });

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
                <button className="btn-primary" onClick={() => publishNow.mutate()} disabled={publishNow.isPending}>
                  {publishNow.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  {publishNow.isPending ? "כותב ומפרסם..." : "כתוב ופרסם עכשיו"}
                </button>
                <button className="btn-secondary" onClick={() => { if (confirm("לנתק את WordPress?")) disconnect.mutate(); }}><Trash2 size={16} /> נתק</button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={wp.enabled} className="h-4 w-4 accent-brand-600" onChange={(e) => settings.mutate({ enabled: e.target.checked })} />
                <span className="text-slate-700">פרסום שבועי אוטומטי פעיל</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">מצב:</span>
                <select className="input py-1 text-sm w-40" value={wp.mode} onChange={(e) => settings.mutate({ mode: e.target.value as any })}>
                  <option value="publish">פרסום מלא (live)</option>
                  <option value="draft">טיוטה לאישור</option>
                </select>
              </div>
              {wp.last_published_at && <span className="text-xs text-slate-400">פורסם לאחרונה: {new Date(wp.last_published_at).toLocaleString("he-IL")}</span>}
            </div>
            <div className="mt-3 text-xs text-slate-500 flex items-center gap-1.5">
              <CalendarClock size={14} /> מאמר חדש עולה אוטומטית כל יום שני, מבוסס על הזדמנויות ה-SEO של הלקוח — גם כשהמחשב כבוי.
            </div>
            {wp.mode === "publish" && (
              <div className="mt-2 text-xs text-amber-600 flex items-center gap-1.5">
                <AlertTriangle size={14} /> מצב "פרסום מלא": המאמר עולה חי לאתר בלי בדיקה. אפשר לעבור ל"טיוטה" כדי לאשר לפני.
              </div>
            )}
            {publishNow.isError && <div className="mt-3 text-sm text-rose-600">{(publishNow.error as any)?.message}</div>}
            {publishNow.isSuccess && (
              <div className="mt-3 text-sm text-emerald-700">
                נוצר: "{(publishNow.data as any).title}" (מילה: {(publishNow.data as any).keyword}) — <a href={(publishNow.data as any).url} target="_blank" rel="noreferrer" className="underline">צפה</a>
              </div>
            )}
          </div>

          {/* Instructions / continuous improvement */}
          <div className="card mb-6">
            <h3 className="font-semibold flex items-center gap-2 text-slate-800 mb-1"><GraduationCap size={18} className="text-brand-600" /> הנחיות לסוכן (תהליך שיפור מתמיד)</h3>
            <p className="text-xs text-slate-500 mb-2">כתוב מה חשוב לדעת על הלקוח, על מה לכתוב ומה לתקן — הסוכן מכבד זאת בכל מאמר. לדוגמה: "העסק מתמחה ב-X ומשרת אזור Y", "טון מקצועי אך נגיש", "תמיד להוסיף קריאה לפעולה לפנייה", "אל תכתוב על נושא Z".</p>
            <textarea className="input" rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="הנחיות לסוכן..." />
            <div className="flex items-center gap-2 mt-2">
              <button className="btn-primary text-sm py-1.5" onClick={() => saveInstructions.mutate()} disabled={saveInstructions.isPending}>
                {saveInstructions.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} שמור הנחיות
              </button>
              {saveInstructions.isSuccess && <span className="text-sm text-emerald-600">נשמר ✓</span>}
            </div>
          </div>

          {/* History */}
          <div className="card">
            <h3 className="font-semibold flex items-center gap-2 text-slate-800 mb-3"><Newspaper size={18} /> היסטוריית מאמרים</h3>
            {!posts || posts.length === 0 ? (
              <p className="text-slate-400 text-sm">עדיין לא פורסמו מאמרים. לחץ "כתוב ופרסם עכשיו" או המתן לריצה השבועית.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {posts.map((p: BlogPost) => (
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
        </>
      )}
    </div>
  );
}
