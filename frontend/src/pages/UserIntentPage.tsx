import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Search, ExternalLink, Target, Loader2, Save, ChevronDown, ChevronUp, Sparkles, FileSearch, MessageCircle, Gauge, ArrowUpDown, Check } from "lucide-react";
import * as api from "../api";
import type { KwPageRow, KeywordTarget, PageKeyword, PageIntent } from "../api";
import PageHeader from "../components/PageHeader";
import DataSourceBanner from "../components/DataSourceBanner";
import Spinner from "../components/Spinner";
import { useFocusTarget } from "../components/useFocusTarget";

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function decodePath(u: string): string {
  try { return decodeURIComponent(u.replace(/^https?:\/\/[^/]+/, "")) || u; } catch { return u; }
}
const norm = (u: string) => (u || "").replace(/\/+$/, "").toLowerCase();

interface PageData {
  page: string; title: string | null; meta: string | null; isNew: boolean;
  primary: string[]; secondary: string[]; gsc: KwPageRow[];
  totalImpr: number; totalClicks: number; saved?: PageIntent;
}

function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="badge bg-slate-100 text-slate-500 inline-flex items-center gap-1"><Gauge size={11} /> טרם דורג</span>;
  const tone = score >= 8 ? "bg-emerald-50 text-emerald-700" : score >= 5 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";
  return <span className={`badge ${tone} inline-flex items-center gap-1`}><Gauge size={11} /> איכות {score}/10</span>;
}

/** Per-page analysis card: runs the 4 steps and persists the result. */
function IntentCard({ cid, data, onSaved }: { cid: number; data: PageData; onSaved: () => void }) {
  const [openCard, setOpenCard] = useState(false);
  const [intentText, setIntentText] = useState(data.saved?.intent_analysis || "");
  const [pageText, setPageText] = useState(data.saved?.page_analysis || "");
  const [conclusions, setConclusions] = useState(data.saved?.conclusions || "");
  const [score, setScore] = useState<number | null>(data.saved?.quality_score ?? null);
  const [consultQ, setConsultQ] = useState("");
  const [consultLog, setConsultLog] = useState<{ q: string; a: string }[]>([]);

  const base = { page_url: data.page, primary_keywords: data.primary, secondary_keywords: data.secondary };
  const runIntent = useMutation({
    mutationFn: () => api.analyzePageIntent(cid, { ...base, action: "intent" }),
    onSuccess: (r) => { if (r.intent_analysis) setIntentText(r.intent_analysis); },
  });
  const runPage = useMutation({
    mutationFn: () => api.analyzePageIntent(cid, { ...base, action: "page", intent_analysis: intentText }),
    onSuccess: (r) => {
      if (r.page_analysis) setPageText(r.page_analysis);
      if (r.conclusions) setConclusions((c) => c ? c : r.conclusions!);
      if (r.quality_score != null) setScore(r.quality_score);
    },
  });
  const consult = useMutation({
    mutationFn: () => api.analyzePageIntent(cid, { ...base, action: "consult", intent_analysis: intentText, page_analysis: pageText, conclusions, question: consultQ }),
    onSuccess: (r) => { if (r.answer) { setConsultLog((l) => [...l, { q: consultQ, a: r.answer! }]); setConsultQ(""); } },
  });
  const save = useMutation({
    mutationFn: () => api.savePageIntent(cid, data.page, {
      intent_analysis: intentText || null, page_analysis: pageText || null, conclusions: conclusions || null,
      quality_score: score, primary_keywords: data.primary, secondary_keywords: data.secondary,
      saved_summary: `עמוד: ${data.title || decodePath(data.page)} | עיקריות: ${data.primary.join(", ") || "—"} | משניות: ${data.secondary.join(", ") || "—"}${score != null ? ` | איכות ${score}/10` : ""}`,
    }),
    onSuccess: onSaved,
  });

  const hasAnalysis = intentText || pageText || conclusions;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <button className="flex items-center gap-1.5 text-right min-w-0" onClick={() => setOpenCard((o) => !o)}>
            {openCard ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
            <span className="font-semibold text-slate-900 truncate">{data.title || decodePath(data.page)}</span>
          </button>
          <a href={data.page} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1 min-w-0 mt-0.5"><ExternalLink size={11} className="shrink-0" /><span className="truncate">{decodePath(data.page)}</span></a>
          {data.meta && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{data.meta}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <ScoreBadge score={score} />
            <span className={`badge ${data.isNew ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-500"}`}>{data.isNew ? "עמוד חדש (טרם נכתב)" : "עמוד קיים"}</span>
            {data.saved && <span className="badge bg-emerald-50 text-emerald-700 inline-flex items-center gap-1"><Check size={11} /> נשמר</span>}
          </div>
          <span className="text-xs text-slate-400">{data.totalImpr.toLocaleString()} חשיפות · {data.totalClicks.toLocaleString()} כניסות</span>
        </div>
      </div>

      {/* Keyword summary (always visible) */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {data.primary.map((k) => <span key={k} className="badge bg-emerald-50 text-emerald-700 inline-flex items-center gap-1"><Target size={11} /> {k}</span>)}
        {data.secondary.map((k) => <span key={k} className="badge bg-blue-50 text-blue-700">{k}</span>)}
        {data.primary.length === 0 && data.secondary.length === 0 && <span className="text-xs text-slate-400">לא הוגדרו ביטויי יעד/משנה לעמוד זה.</span>}
      </div>

      {openCard && (
        <div className="mt-3 border-t border-slate-100 pt-3 space-y-3">
          {/* Ranking keywords detail */}
          {data.gsc.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-500 text-xs">כל הביטויים המדורגים ({data.gsc.length})</summary>
              <ul className="mt-1 divide-y divide-slate-100">
                {data.gsc.map((r) => (
                  <li key={r.term} className="py-1 flex items-center justify-between gap-2">
                    <span className="text-slate-700 truncate">{r.term}</span>
                    <span className="text-xs text-slate-400 shrink-0">מ' {r.position} · {r.impressions.toLocaleString()} ח' · {r.clicks.toLocaleString()} כ'</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary text-sm" onClick={() => runIntent.mutate()} disabled={runIntent.isPending}>
              {runIntent.isPending ? <Loader2 size={15} className="animate-spin" /> : <Brain size={15} />} 1. ניתוח כוונת המשתמש
            </button>
            <button className="btn-secondary text-sm" onClick={() => runPage.mutate()} disabled={runPage.isPending}>
              {runPage.isPending ? <Loader2 size={15} className="animate-spin" /> : <FileSearch size={15} />} 2. נתח את הדף הקיים
            </button>
            <button className="btn-primary text-sm" onClick={() => save.mutate()} disabled={save.isPending || !hasAnalysis}>
              {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} 4. שמירת הניתוח
            </button>
          </div>
          {(runIntent.isError || runPage.isError) && <div className="text-sm text-rose-600">{((runIntent.error || runPage.error) as any)?.message}</div>}
          {save.isSuccess && <div className="text-sm text-emerald-600">הניתוח נשמר ✓ — ישמש בתכנית העבודה, בהמלצות ובבלוג.</div>}

          {/* Editable analysis blocks */}
          {(intentText || runIntent.isSuccess) && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">כוונת המשתמש ומי המשתמש (ניתן לערוך)</label>
              <textarea className="input text-sm w-full" rows={6} value={intentText} onChange={(e) => setIntentText(e.target.value)} dir="rtl" />
            </div>
          )}
          {(pageText || runPage.isSuccess) && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">ניתוח הדף הקיים (ניתן לערוך)</label>
              <textarea className="input text-sm w-full" rows={6} value={pageText} onChange={(e) => setPageText(e.target.value)} dir="rtl" />
            </div>
          )}
          {(conclusions || pageText || intentText) && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">מסקנות, הזדמנויות ותוספות מומלצות (ניתן לערוך ולהוסיף משלך)</label>
              <textarea className="input text-sm w-full" rows={5} value={conclusions} onChange={(e) => setConclusions(e.target.value)} dir="rtl" placeholder="מה חסר בעמוד, אילו הזדמנויות לנצל, המלצות משלך..." />
              <div className="flex items-center gap-2 mt-1">
                <label className="text-xs text-slate-500">ציון איכות:</label>
                <input type="number" min={1} max={10} className="input py-0.5 text-sm w-16" value={score ?? ""} onChange={(e) => setScore(e.target.value ? Math.min(10, Math.max(1, Number(e.target.value))) : null)} />
              </div>
            </div>
          )}

          {/* 3. Consult with AI */}
          {hasAnalysis && (
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <input className="input py-1 text-sm flex-1" placeholder="שאל את ה-AI על הניתוח..." value={consultQ} onChange={(e) => setConsultQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && consultQ.trim()) consult.mutate(); }} />
                <button className="btn-secondary text-sm" onClick={() => consult.mutate()} disabled={consult.isPending || !consultQ.trim()}>
                  {consult.isPending ? <Loader2 size={15} className="animate-spin" /> : <MessageCircle size={15} />} 3. התייעץ
                </button>
              </div>
              {consultLog.map((e, i) => (
                <div key={i} className="mb-2 text-sm">
                  <div className="font-medium text-slate-700">{e.q}</div>
                  <div className="text-slate-600 whitespace-pre-wrap bg-white border border-slate-200 rounded p-2 mt-1">{e.a}</div>
                  <button className="text-xs text-brand-600 hover:underline mt-1" onClick={() => setConclusions((c) => (c ? c + "\n\n" : "") + e.a)}>הוסף למסקנות</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function UserIntentPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();

  const today = new Date();
  const [from, setFrom] = useState(fmt(new Date(today.getTime() - 90 * 86400000)));
  const [to, setTo] = useState(fmt(today));
  const [q, setQ] = useState("");
  const [onlyDefined, setOnlyDefined] = useState(true);
  const [sortDesc, setSortDesc] = useState(true);

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: rows, isLoading, refetch, isFetching } = useQuery({ queryKey: ["kw-map", cid, from, to], queryFn: () => api.getKeywordPageMap(cid, from, to), enabled: !!cid });
  const { data: targets } = useQuery({ queryKey: ["kw-targets", cid], queryFn: () => api.listKeywordTargets(cid), enabled: !!cid });
  const { data: pageKws } = useQuery({ queryKey: ["page-keywords", cid], queryFn: () => api.listPageKeywords(cid), enabled: !!cid });
  const { data: crawled } = useQuery({ queryKey: ["crawled-pages", cid], queryFn: () => api.listCrawledPages(cid), enabled: !!cid });
  const { data: saved } = useQuery({ queryKey: ["page-intent", cid], queryFn: () => api.listPageIntent(cid), enabled: !!cid });
  const onSaved = () => qc.invalidateQueries({ queryKey: ["page-intent", cid] });

  const byPage = useMemo(() => {
    const m = new Map<string, KwPageRow[]>();
    for (const r of rows || []) { if (!m.has(r.page)) m.set(r.page, []); m.get(r.page)!.push(r); }
    for (const arr of m.values()) arr.sort((a, b) => b.impressions - a.impressions);
    return m;
  }, [rows]);
  const targetKwByPage = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const t of (targets || []) as KeywordTarget[]) { if (t.status === "parked" || t.intent === "new_page" || !t.page_url) continue; const k = norm(t.page_url); if (!m.has(k)) m.set(k, []); m.get(k)!.push(t.keyword); }
    return m;
  }, [targets]);
  const secondaryByPage = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const pk of (pageKws || []) as PageKeyword[]) { const k = norm(pk.page_url); if (!m.has(k)) m.set(k, []); m.get(k)!.push(pk.keyword); }
    return m;
  }, [pageKws]);
  const crawledMap = useMemo(() => { const m = new Map<string, { title: string | null; meta: string | null }>(); for (const c of crawled || []) m.set(norm(c.url), { title: c.title, meta: c.meta_description }); return m; }, [crawled]);
  const savedByPage = useMemo(() => { const m = new Map<string, PageIntent>(); for (const s of saved || []) m.set(norm(s.page_url), s); return m; }, [saved]);

  const pages: PageData[] = useMemo(() => {
    const urls = new Map<string, string>();
    for (const c of crawled || []) urls.set(norm(c.url), c.url);
    for (const p of byPage.keys()) if (!urls.has(norm(p))) urls.set(norm(p), p);
    for (const [k] of targetKwByPage) if (!urls.has(k)) { const t = (targets || []).find((x) => norm(x.page_url || "") === k); if (t?.page_url) urls.set(k, t.page_url); }
    for (const pk of (pageKws || []) as PageKeyword[]) if (!urls.has(norm(pk.page_url))) urls.set(norm(pk.page_url), pk.page_url);
    let list: PageData[] = [...urls.values()].map((page) => {
      const nk = norm(page);
      const gsc = byPage.get(page) || [];
      const cr = crawledMap.get(nk);
      return {
        page, title: cr?.title || null, meta: cr?.meta || null,
        isNew: !crawledMap.has(nk) && gsc.length === 0,
        primary: targetKwByPage.get(nk) || [], secondary: secondaryByPage.get(nk) || [], gsc,
        totalImpr: gsc.reduce((s, r) => s + r.impressions, 0), totalClicks: gsc.reduce((s, r) => s + r.clicks, 0),
        saved: savedByPage.get(nk),
      };
    });
    if (onlyDefined) list = list.filter((p) => p.primary.length > 0 || p.secondary.length > 0 || p.saved);
    if (q.trim()) { const s = q.trim().toLowerCase(); list = list.filter((p) => (p.title || "").toLowerCase().includes(s) || decodePath(p.page).toLowerCase().includes(s) || p.primary.some((k) => k.toLowerCase().includes(s)) || p.secondary.some((k) => k.toLowerCase().includes(s))); }
    const dir = sortDesc ? 1 : -1;
    return list.sort((a, b) => ((b.primary.length + b.secondary.length) - (a.primary.length + a.secondary.length)) || (b.totalImpr - a.totalImpr) * dir);
  }, [crawled, byPage, targetKwByPage, secondaryByPage, crawledMap, savedByPage, targets, pageKws, onlyDefined, q, sortDesc]);

  // Deep link from the work plan (?focus=<page_url>).
  useFocusTarget(!isLoading && saved !== undefined, () => setQ(""));

  return (
    <div>
      <PageHeader title="כוונת המשתמש" subtitle={client ? `${client.name} · ניתוח כוונת החיפוש לכל עמוד` : "כוונת המשתמש"} />
      <DataSourceBanner cid={cid} match={["Search Console"]} />

      <div className="card mb-4">
        <p className="text-sm text-slate-600 mb-3">
          לכל עמוד: הביטויים העיקריים והמשניים, נתוני התנועה, וציון איכות לפי כוונת המשתמש. הפעל את הניתוח (כוונת המשתמש → ניתוח הדף),
          ערוך את המסקנות ושמור — הניתוח יישמר ויוזן לתכנית העבודה, להמלצות ולבלוג האוטומטי.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="block text-xs text-slate-500 mb-1">מתאריך</label><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="block text-xs text-slate-500 mb-1">עד תאריך</label><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>{isFetching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} רענן</button>
          <label className="text-xs text-slate-500 inline-flex items-center gap-1 cursor-pointer"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={onlyDefined} onChange={(e) => setOnlyDefined(e.target.checked)} /> רק עמודים עם ביטויי יעד/משנה</label>
          <button className="btn-secondary text-xs py-1 px-2" onClick={() => setSortDesc((d) => !d)}><ArrowUpDown size={13} /> {sortDesc ? "חשיפות גבוה→נמוך" : "נמוך→גבוה"}</button>
          <div className="relative">
            <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input py-1 text-sm pr-7 w-52" placeholder="חפש עמוד / ביטוי" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : pages.length === 0 ? (
        <div className="card text-center py-10 text-slate-500 text-sm">
          <Brain size={36} className="mx-auto mb-2 text-slate-300" />
          {onlyDefined ? 'אין עדיין עמודים עם ביטויי יעד/משנה. הגדר אותם בלשוניות "ביטויי יעד" ו"עמודי יעד וביטויי משנה", או בטל את הסינון.' : "אין עמודים להצגה."}
        </div>
      ) : (
        <div className="space-y-3">
          {pages.map((p) => <div key={p.page} data-focus={p.saved?.page_url ?? p.page}><IntentCard cid={cid} data={p} onSaved={onSaved} /></div>)}
        </div>
      )}
    </div>
  );
}
