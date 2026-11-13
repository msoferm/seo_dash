import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanSearch, Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import * as api from "../api";

function decodePath(u: string): string {
  try { return decodeURIComponent(u.replace(/^https?:\/\/[^/]+/, "")) || u; } catch { return u; }
}
const fmtDate = (d: string) => new Date(d).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
/** A scan still "running" after 15 minutes was cut off by the server. */
const isStale = (s: api.SiteScan) => s.status === "running" && Date.now() - new Date(s.started_at).getTime() > 15 * 60000;

/** "סרוק את כל דפי האתר": reads the full text of every page; the AI analyses rely on it. */
export default function SiteScanPanel({ cid }: { cid: number }) {
  const qc = useQueryClient();
  const [showPages, setShowPages] = useState(false);
  const { data: scan } = useQuery({
    queryKey: ["site-scan", cid], queryFn: () => api.getLatestSiteScan(cid), enabled: !!cid,
    refetchInterval: (q) => (q.state.data?.status === "running" && !isStale(q.state.data) ? 3000 : false),
  });
  const start = useMutation({ mutationFn: () => api.startSiteScan(cid), onSuccess: () => qc.invalidateQueries({ queryKey: ["site-scan", cid] }) });
  const running = scan?.status === "running" && !isStale(scan);
  // When a scan finishes, refresh everything that relies on the page list (all tabs).
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current) { wasRunning.current = false; for (const k of ["crawled-pages", "structure-analysis", "datasets"]) qc.invalidateQueries({ queryKey: [k, cid] }); }
  }, [running, qc, cid]);
  const problems = (scan?.pages || []).filter((p) => !p.ok || p.issue);

  return (
    <div className="card mb-6 border-r-4 border-r-brand-400">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold flex items-center gap-2 text-slate-800"><ScanSearch size={18} className="text-brand-600" /> סריקת כל דפי האתר</h3>
        <button className="btn-primary text-sm" disabled={running || start.isPending} onClick={() => start.mutate()}>
          {running || start.isPending ? <Loader2 size={15} className="animate-spin" /> : <ScanSearch size={15} />} סרוק את כל דפי האתר
        </button>
      </div>
      <p className="text-xs text-slate-500 mt-1">
        המערכת קוראת את הטקסט המלא של כל דף באתר ושומרת אותו. הייעוץ וניתוח ה-AI בלשונית ביטויי היעד, וכוונת המשתמש, מסתמכים על הסריקה הזו ומציינים מאיזה תאריך היא. הסריקה רק קוראת ולא משנה דבר באתר.
      </p>
      {start.isError && <div className="mt-2 text-sm text-rose-600">{(start.error as Error).message}</div>}

      {scan && (
        <div className="mt-3 text-sm">
          {running ? (
            <div className="text-slate-600 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> סורק… {scan.pages.length}/{scan.pages_total || "?"} דפים</div>
          ) : scan.status === "failed" || isStale(scan) ? (
            <div className="text-rose-700 flex items-center gap-1.5"><AlertTriangle size={14} /> הסריקה מ-{fmtDate(scan.started_at)} נכשלה{scan.error ? `: ${scan.error}` : " או נקטעה באמצע"}. {scan.pages.length > 0 && `${scan.pages.length} דפים נשמרו.`}</div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-800"><CheckCircle2 size={15} /> סריקה אחרונה: <b>{fmtDate(scan.finished_at || scan.started_at)}</b> · {scan.method === "wordpress" ? "רשימת הדפים מ-WordPress" : "רשימת הדפים ממפת האתר (sitemap)"}</div>
              {scan.new_pages && (
                <div className={scan.new_pages.length || scan.removed_pages?.length ? "text-violet-800" : "text-slate-500"}>
                  {scan.new_pages.length || scan.removed_pages?.length
                    ? <>לעומת הסריקה הקודמת: {scan.new_pages.length > 0 && <><b>{scan.new_pages.length}</b> דפים חדשים ({scan.new_pages.map((p) => p.title || decodePath(p.url)).join(" · ")})</>}{scan.new_pages.length > 0 && (scan.removed_pages?.length || 0) > 0 && " · "}{(scan.removed_pages?.length || 0) > 0 && <><b>{scan.removed_pages!.length}</b> דפים שכבר לא נמצאו ({scan.removed_pages!.map((p) => p.title || decodePath(p.url)).join(" · ")})</>}. כל הלשוניות עודכנו עם רשימת הדפים החדשה.</>
                    : "אין דפים חדשים לעומת הסריקה הקודמת."}
                </div>
              )}
              <div className="text-slate-700"><b>{scan.pages_total}</b> דפים נסרקו · <span className="text-emerald-700">{scan.pages_ok} תקינים</span> · {problems.length ? <span className="text-amber-700">{problems.length} עם בעיה או הערה</span> : "ללא בעיות"}</div>
            </div>
          )}

          {problems.length > 0 && !running && (
            <ul className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs space-y-0.5">
              {problems.map((p) => (
                <li key={p.url} className="flex flex-wrap gap-1"><a href={p.url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{p.title || decodePath(p.url)}</a> <span className="text-amber-800">— {p.issue || "בעיה בקריאה"}</span></li>
              ))}
            </ul>
          )}

          {scan.pages.length > 0 && (
            <button className="mt-2 text-xs text-slate-500 hover:text-brand-600 inline-flex items-center gap-1" onClick={() => setShowPages((s) => !s)}>
              {showPages ? <ChevronUp size={12} /> : <ChevronDown size={12} />} רשימת הדפים ({scan.pages.length})
            </button>
          )}
          {showPages && (
            <div className="overflow-x-auto mt-1">
              <table className="w-full text-xs">
                <thead><tr className="text-right text-slate-500 border-b border-slate-200"><th className="py-1 px-2 font-medium">דף</th><th className="py-1 px-2 font-medium">מילים</th><th className="py-1 px-2 font-medium">מצב</th></tr></thead>
                <tbody>
                  {[...scan.pages].sort((a, b) => Number(a.ok) - Number(b.ok)).map((p) => (
                    <tr key={p.url} className="border-b border-slate-100">
                      <td className="py-1 px-2"><a href={p.url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center gap-1"><ExternalLink size={10} /> {p.title || decodePath(p.url)}</a><div className="text-slate-400 truncate max-w-[420px]">{decodePath(p.url)}</div></td>
                      <td className="py-1 px-2">{p.words.toLocaleString()}</td>
                      <td className="py-1 px-2">{p.ok ? <span className="text-emerald-700">{p.issue ? `תקין · ${p.issue}` : "תקין"}</span> : <span className="text-rose-600">{p.issue || "נכשל"}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One-line note for the AI tabs: which site scan the analysis relies on. */
export function SiteScanNote({ cid }: { cid: number }) {
  const { data: scan } = useQuery({ queryKey: ["site-scan", cid], queryFn: () => api.getLatestSiteScan(cid), enabled: !!cid });
  const done = scan && scan.status !== "running" && scan.pages_ok > 0;
  return (
    <span className={`text-xs inline-flex items-center gap-1 ${done ? "text-slate-500" : "text-amber-700"}`}>
      <ScanSearch size={12} />
      {done ? `מסתמך על סריקת דפי האתר מ-${fmtDate(scan!.finished_at || scan!.started_at)} (${scan!.pages_ok} דפים)` : 'טרם נסרקו הטקסטים של דפי האתר. מומלץ להריץ "סרוק את כל דפי האתר" בלשונית העלאת נתונים'}
    </span>
  );
}
