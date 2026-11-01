import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Newspaper, Loader2, Plug, Check, ExternalLink, Trash2, Send, CalendarClock, AlertTriangle, Save, Lightbulb, X, Pencil, MessageCircle, Link2, Plus, ChevronDown, ChevronUp, RotateCcw, Target, Folder, FolderPlus } from "lucide-react";
import * as api from "../api";
import type { BlogPost } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import ArticleEditor, { type ArticleEditorHandle } from "../components/ArticleEditor";
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

  // #3: internal links are chosen AFTER the sample is generated, then woven into the article.
  const [ilOpen, setIlOpen] = useState(false);
  const [ilSel, setIlSel] = useState<api.InternalLink[]>([]);
  const { data: pages } = useQuery({ queryKey: ["client-pages", cid], queryFn: () => api.listClientPages(cid), enabled: ilOpen });
  const { data: ktargets } = useQuery({ queryKey: ["kw-targets", cid], queryFn: () => api.listKeywordTargets(cid), enabled: ilOpen });
  const targetPages = new Set((ktargets || []).filter((t) => t.page_url).map((t) => t.page_url as string));
  const cleanInternalLinks = ilSel.filter((l) => /^https?:\/\//i.test(l.url));
  const toggleIl = (url: string) => setIlSel((l) => l.some((x) => x.url === url) ? l.filter((x) => x.url !== url) : [...l, { url, anchor: "" }]);
  const setIlAnchor = (url: string, anchor: string) => setIlSel((l) => l.map((x) => x.url === url ? { ...x, anchor } : x));

  // #1a + #2b: edit the generated sample (WYSIWYG) and publish it as-is.
  const editorRef = useRef<ArticleEditorHandle>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editExcerpt, setEditExcerpt] = useState("");
  const [linksAdded, setLinksAdded] = useState(0);

  const approve = useMutation({ mutationFn: (mod?: string) => api.approveBlogProposal(p.id, mod), onSuccess: invalidate });
  const reject = useMutation({ mutationFn: () => api.rejectBlogProposal(p.id), onSuccess: invalidate });
  const markDone = useMutation({ mutationFn: () => api.setBlogPostDone(p.id), onSuccess: invalidate });
  const sample = useMutation({
    mutationFn: () => api.sampleBlog(cid, p.keyword || undefined, cleanSources, modOpen ? modText.trim() : undefined),
    onSuccess: (data) => { setEditTitle(data.title || ""); setEditExcerpt(data.excerpt || ""); setLinksAdded(0); },
  });
  const publishEdited = useMutation({ mutationFn: () => api.publishEditedBlog(cid, { title: editTitle, html: editorRef.current?.getHtml() || "", excerpt: editExcerpt, keyword: p.keyword || undefined, proposalId: p.id }), onSuccess: invalidate });
  const addLinksToArticle = () => { editorRef.current?.insertLinks(cleanInternalLinks); setLinksAdded(cleanInternalLinks.length); };
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
        <div className="mt-3 border border-brand-200 rounded-lg p-3 bg-white">
          <div className="text-xs text-emerald-600 mb-2">הדוגמה מוכנה — ערוך את הטקסט ישירות (בלי קוד), הוסף קישורים פנימיים, ואז "פרסם את הגרסה הזו". שום דבר לא עולה לאתר עד שתלחץ פרסם.</div>
          <label className="block text-xs text-slate-500 mb-1">כותרת</label>
          <input className="input mb-2" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          <label className="block text-xs text-slate-500 mb-1">תיאור מטא (Excerpt)</label>
          <input className="input mb-2" value={editExcerpt} onChange={(e) => setEditExcerpt(e.target.value)} />
          <label className="block text-xs text-slate-500 mb-1">גוף המאמר</label>
          <ArticleEditor ref={editorRef} initialHtml={sample.data.body || sample.data.preview || ""} />

          {/* #3: internal links — chosen after the article exists, then woven in */}
          <div className="mt-3 border-t border-slate-100 pt-3">
            <button className="btn-secondary text-sm py-1.5" onClick={() => setIlOpen((o) => !o)}>
              <Link2 size={15} /> קישורים פנימיים{cleanInternalLinks.length ? ` (${cleanInternalLinks.length} נבחרו)` : ""} {ilOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {ilOpen && (
              <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-2">בחר עמודים רלוונטיים לקישור מתוך המאמר. עמוד שסומן כיעד בלשונית "אופטימיזציית מבנה ומילות מפתח" מסומן כ-<span className="text-brand-700 font-medium">עמוד יעד</span> (כדאי לקשר אליו).</p>
                {!pages ? (
                  <div className="text-xs text-slate-400 flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> טוען עמודים...</div>
                ) : pages.length === 0 ? (
                  <div className="text-xs text-slate-400">לא נמצאו עמודים (צריך נתוני Search Console ללקוח).</div>
                ) : (
                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                    {[...pages].sort((a, b) => (targetPages.has(b.page) ? 1 : 0) - (targetPages.has(a.page) ? 1 : 0)).map((pg) => {
                      const sel = ilSel.find((x) => x.url === pg.page);
                      const isTarget = targetPages.has(pg.page);
                      const label = (() => { try { return decodeURIComponent(pg.page.replace(/^https?:\/\/[^/]+/, "")) || pg.page; } catch { return pg.page; } })();
                      return (
                        <div key={pg.page} className="py-1.5">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" className="h-4 w-4 accent-brand-600 shrink-0" checked={!!sel} onChange={() => toggleIl(pg.page)} />
                            <span className="text-sm text-slate-700 truncate flex-1" title={pg.page}>{label}</span>
                            {isTarget && <span className="badge bg-brand-50 text-brand-700 inline-flex items-center gap-0.5 shrink-0"><Target size={10} /> עמוד יעד</span>}
                            <span className="text-xs text-slate-400 shrink-0">{pg.impressions} חשיפות</span>
                          </label>
                          {sel && (
                            <input className="input text-xs py-1 mt-1 mr-6" placeholder="טקסט עוגן מועדף (אופציונלי)"
                              value={sel.anchor || ""} onChange={(e) => setIlAnchor(pg.page, e.target.value)} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <button className="btn-primary text-sm py-1" onClick={addLinksToArticle} disabled={cleanInternalLinks.length === 0}>
                    <Plus size={14} /> הוסף קישורים למאמר
                  </button>
                  {linksAdded > 0 && <span className="text-xs text-emerald-600">{linksAdded} קישורים נוספו למאמר ✓ (ניתן לערוך/להסיר בעורך למעלה)</span>}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 mt-3 flex-wrap border-t border-slate-100 pt-3">
            <button className="btn-primary text-sm py-1.5" onClick={() => publishEdited.mutate()} disabled={publishEdited.isPending || !editTitle.trim()}>
              {publishEdited.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} פרסם את הגרסה הזו
            </button>
            {publishEdited.isSuccess && <span className="text-sm text-emerald-600">פורסם ✓ {publishEdited.data?.url && <a href={publishEdited.data.url} target="_blank" rel="noreferrer" className="underline">צפה</a>}</span>}
            {publishEdited.isError && <span className="text-sm text-rose-600">{(publishEdited.error as any)?.message}</span>}
          </div>
        </div>
      )}
      {approve.isError && <div className="text-sm text-rose-600 mt-2">{(approve.error as any)?.message}</div>}

      <TaskAssistant cid={cid} open={chatOpen} onClose={() => setChatOpen(false)} seed={chatSeed} />
    </li>
  );
}

/** #4a: blog history grouped into user-controlled folders (name + date range, renameable/deletable). */
function BlogHistory({ cid, history, hint, invalidate }: { cid: number; history: BlogPost[]; hint: string; invalidate: () => void }) {
  const qc = useQueryClient();
  const { data: folders } = useQuery({ queryKey: ["blog-folders", cid], queryFn: () => api.listBlogFolders(cid), enabled: !!cid });
  const invalidateFolders = () => qc.invalidateQueries({ queryKey: ["blog-folders", cid] });

  const revert = useMutation({ mutationFn: (id: number) => api.revertBlogPost(id), onSuccess: invalidate });
  const createFolder = useMutation({ mutationFn: (p: { name: string; from: string | null; to: string | null }) => api.createBlogFolder(cid, p.name, p.from, p.to), onSuccess: invalidateFolders });
  const updateFolder = useMutation({ mutationFn: (p: { id: number; patch: { name?: string; date_from?: string | null; date_to?: string | null } }) => api.updateBlogFolder(p.id, p.patch), onSuccess: invalidateFolders });
  const deleteFolder = useMutation({ mutationFn: (id: number) => api.deleteBlogFolder(id), onSuccess: invalidateFolders });

  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editFrom, setEditFrom] = useState("");
  const [editTo, setEditTo] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");

  const inRange = (createdAt: string, f: api.BlogFolder) => {
    const d = (createdAt || "").slice(0, 10);
    if (!d) return false;
    if (f.date_from && d < f.date_from) return false;
    if (f.date_to && d > f.date_to) return false;
    return true;
  };
  // Each article lands in exactly ONE folder — the first (newest-first) whose range contains it.
  const flist = folders || [];
  const byFolder = new Map<number, BlogPost[]>();
  const unfiled: BlogPost[] = [];
  for (const p of history) {
    const f = flist.find((fl) => inRange(p.created_at, fl));
    if (f) { if (!byFolder.has(f.id)) byFolder.set(f.id, []); byFolder.get(f.id)!.push(p); }
    else unfiled.push(p);
  }

  const fmtDate = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" }) : null);
  const rangeLabel = (f: api.BlogFolder) => {
    const a = fmtDate(f.date_from), b = fmtDate(f.date_to);
    if (a && b) return `${a} – ${b}`;
    if (a) return `מ-${a}`;
    if (b) return `עד ${b}`;
    return "כל התאריכים";
  };

  const startEdit = (f: api.BlogFolder) => { setEditId(f.id); setEditName(f.name); setEditFrom(f.date_from || ""); setEditTo(f.date_to || ""); };
  const saveEdit = () => {
    if (editId == null || !editName.trim()) return;
    updateFolder.mutate({ id: editId, patch: { name: editName.trim(), date_from: editFrom || null, date_to: editTo || null } });
    setEditId(null);
  };
  const saveNew = () => {
    if (!newName.trim()) return;
    createFolder.mutate({ name: newName.trim(), from: newFrom || null, to: newTo || null });
    setNewName(""); setNewFrom(""); setNewTo(""); setAdding(false);
  };

  const ArticleItem = ({ p }: { p: BlogPost }) => (
    <li className="py-3 px-3 flex items-start gap-3">
      <span className={`badge ${STATUS_BADGE[p.status || ""] || "bg-slate-100 text-slate-600"} shrink-0 mt-0.5`}>{STATUS_LABEL[p.status || ""] || p.status}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-900">{p.title}</div>
        <div className="text-xs text-slate-400">{p.keyword && <>מילה: {p.keyword} · </>}{new Date(p.created_at).toLocaleString("he-IL")}</div>
        {p.error && <div className="text-xs text-rose-600 mt-0.5 break-words">{p.error}</div>}
      </div>
      {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline text-sm inline-flex items-center gap-1 shrink-0"><ExternalLink size={13} /> צפה</a>}
      <button className="text-slate-400 hover:text-amber-600 text-xs inline-flex items-center gap-1 shrink-0" title="החזר למצב 'לא נכתב' (רק במערכת — לא נוגע באתר)"
        onClick={() => { if (confirm("להחזיר את המאמר למצב 'ממתין' (הצעה)? זה לא נוגע בפוסט באתר — רק מחזיר את הרשומה במערכת לעריכה/כתיבה מחדש.")) revert.mutate(p.id); }}
        disabled={revert.isPending && revert.variables === p.id}>
        {revert.isPending && revert.variables === p.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} החזר
      </button>
    </li>
  );

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h3 className="font-semibold flex items-center gap-2 text-slate-800"><Newspaper size={18} /> היסטוריית מאמרים</h3>
        <button className="btn-secondary text-sm" onClick={() => setAdding((v) => !v)}><FolderPlus size={15} /> תיקייה חדשה</button>
      </div>

      {adding && (
        <div className="mb-4 p-3 rounded-lg border border-brand-200 bg-brand-50/40 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs text-slate-500 mb-1">שם התיקייה</label>
            <input className="input py-1.5 text-sm w-full" placeholder="לדוגמה: קמפיין נובמבר" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">מתאריך</label>
            <input type="date" className="input py-1.5 text-sm" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">עד תאריך</label>
            <input type="date" className="input py-1.5 text-sm" value={newTo} onChange={(e) => setNewTo(e.target.value)} />
          </div>
          <button className="btn-primary text-sm" onClick={saveNew} disabled={!newName.trim() || createFolder.isPending}><Save size={15} /> שמור</button>
          <button className="btn-secondary text-sm" onClick={() => setAdding(false)}><X size={15} /></button>
        </div>
      )}

      {history.length === 0 ? (
        <p className="text-slate-400 text-sm">{hint}</p>
      ) : (
        <div className="space-y-2">
          {flist.map((f) => {
            const items = byFolder.get(f.id) || [];
            const isOpen = openFolders[`f${f.id}`] ?? true;
            const editing = editId === f.id;
            return (
              <div key={f.id} className="border border-slate-200 rounded-lg overflow-hidden">
                {editing ? (
                  <div className="bg-slate-50 px-3 py-2 flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-[140px]">
                      <label className="block text-xs text-slate-500 mb-1">שם</label>
                      <input className="input py-1 text-sm w-full" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">מתאריך</label>
                      <input type="date" className="input py-1 text-sm" value={editFrom} onChange={(e) => setEditFrom(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">עד תאריך</label>
                      <input type="date" className="input py-1 text-sm" value={editTo} onChange={(e) => setEditTo(e.target.value)} />
                    </div>
                    <button className="btn-primary text-sm" onClick={saveEdit} disabled={!editName.trim() || updateFolder.isPending}><Check size={15} /> שמור</button>
                    <button className="btn-secondary text-sm" onClick={() => setEditId(null)}><X size={15} /></button>
                  </div>
                ) : (
                  <div className="w-full flex items-center justify-between gap-2 bg-slate-50 px-3 py-2">
                    <button className="flex items-center gap-2 text-right min-w-0" onClick={() => setOpenFolders((o) => ({ ...o, [`f${f.id}`]: !isOpen }))}>
                      {isOpen ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
                      <Folder size={15} className="text-brand-500 shrink-0" />
                      <span className="font-medium text-slate-700 truncate">{f.name}</span>
                      <span className="text-xs text-slate-400 shrink-0">· {rangeLabel(f)}</span>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-slate-400 ml-1">{items.length} מאמרים</span>
                      <button className="text-slate-400 hover:text-brand-600 p-1" title="ערוך תיקייה" onClick={() => startEdit(f)}><Pencil size={14} /></button>
                      <button className="text-slate-400 hover:text-rose-600 p-1" title="מחק תיקייה (המאמרים לא נמחקים)"
                        onClick={() => { if (confirm(`למחוק את התיקייה "${f.name}"? המאמרים עצמם לא יימחקו — הם יחזרו לרשימה הכללית.`)) deleteFolder.mutate(f.id); }}
                        disabled={deleteFolder.isPending && deleteFolder.variables === f.id}>
                        {deleteFolder.isPending && deleteFolder.variables === f.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </div>
                )}
                {isOpen && !editing && (
                  items.length === 0
                    ? <p className="text-xs text-slate-400 px-3 py-3">אין מאמרים בטווח התאריכים של התיקייה.</p>
                    : <ul className="divide-y divide-slate-100">{items.map((p) => <ArticleItem key={p.id} p={p} />)}</ul>
                )}
              </div>
            );
          })}

          {unfiled.length > 0 && (
            <div className="border border-dashed border-slate-200 rounded-lg overflow-hidden">
              <button className="w-full flex items-center justify-between gap-2 bg-slate-50/60 px-3 py-2 text-right" onClick={() => setOpenFolders((o) => ({ ...o, unfiled: !(o.unfiled ?? true) }))}>
                <span className="font-medium text-slate-500 flex items-center gap-2">
                  {(openFolders.unfiled ?? true) ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />} ללא תיקייה
                </span>
                <span className="text-xs text-slate-400">{unfiled.length} מאמרים</span>
              </button>
              {(openFolders.unfiled ?? true) && <ul className="divide-y divide-slate-100">{unfiled.map((p) => <ArticleItem key={p.id} p={p} />)}</ul>}
            </div>
          )}
        </div>
      )}
    </div>
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

          {/* History — grouped into user-controlled folders with date ranges (#4a) */}
          <BlogHistory
            cid={cid}
            history={(posts || []).filter((p) => ["publish", "draft", "error", "done"].includes(p.status || ""))}
            hint={`עדיין לא פורסמו מאמרים. ${wp.require_approval ? 'לחץ "הצע נושא" לקבלת הצעה' : 'לחץ "כתוב ופרסם עכשיו"'} או המתן לריצה השבועית.`}
            invalidate={invalidate}
          />

          <AssistantFab onClick={askContent} />
          <TaskAssistant cid={cid} open={chatOpen} onClose={() => setChatOpen(false)} seed={chatSeed} />
        </>
      )}
    </div>
  );
}
