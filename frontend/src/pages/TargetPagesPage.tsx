import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Search, ExternalLink, Target, Plus, X, Loader2, ArrowUpDown, FilePlus, PauseCircle, ChevronDown, ChevronUp, FileText } from "lucide-react";
import * as api from "../api";
import type { KwPageRow, KeywordTarget, PageKeyword } from "../api";
import PageHeader from "../components/PageHeader";
import DataSourceBanner from "../components/DataSourceBanner";
import Spinner from "../components/Spinner";

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function decodePath(u: string): string {
  try { return decodeURIComponent(u.replace(/^https?:\/\/[^/]+/, "")) || u; } catch { return u; }
}
const norm = (u: string) => (u || "").replace(/\/+$/, "").toLowerCase();

type SortMetric = "impr" | "clicks" | "pos";

export default function TargetPagesPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();

  const today = new Date();
  const [from, setFrom] = useState(fmt(new Date(today.getTime() - 90 * 86400000)));
  const [to, setTo] = useState(fmt(today));
  const [q, setQ] = useState("");
  const [posMax, setPosMax] = useState("");
  const [imprMin, setImprMin] = useState("");
  const [sortMetric, setSortMetric] = useState<SortMetric>("impr");
  const [sortDesc, setSortDesc] = useState(true);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: rows, isLoading, refetch, isFetching } = useQuery({ queryKey: ["kw-map", cid, from, to], queryFn: () => api.getKeywordPageMap(cid, from, to), enabled: !!cid });
  const { data: targets } = useQuery({ queryKey: ["kw-targets", cid], queryFn: () => api.listKeywordTargets(cid), enabled: !!cid });
  const { data: pageKws } = useQuery({ queryKey: ["page-keywords", cid], queryFn: () => api.listPageKeywords(cid), enabled: !!cid });
  const { data: crawled } = useQuery({ queryKey: ["crawled-pages", cid], queryFn: () => api.listCrawledPages(cid), enabled: !!cid });

  const invTargets = () => qc.invalidateQueries({ queryKey: ["kw-targets", cid] });
  const invPageKws = () => qc.invalidateQueries({ queryKey: ["page-keywords", cid] });
  const addSecondary = useMutation({ mutationFn: (p: { page: string; kw: string }) => api.addPageKeyword(cid, p.page, p.kw), onSuccess: invPageKws });
  const removeSecondary = useMutation({ mutationFn: (id: number) => api.deletePageKeyword(id), onSuccess: invPageKws });
  const newPage = useMutation({ mutationFn: (kw: string) => api.markKeywordNewPage(cid, kw), onSuccess: invTargets });
  const move = useMutation({ mutationFn: (p: { kw: string; page: string }) => api.moveKeywordToPage(cid, p.kw, p.page), onSuccess: invTargets });
  const park = useMutation({ mutationFn: (kw: string) => api.parkKeyword(cid, kw), onSuccess: invTargets });
  const delTarget = useMutation({ mutationFn: (id: number) => api.deleteKeywordTarget(id), onSuccess: invTargets });

  // GSC rows grouped by page, filtered by position/impressions.
  const byPage = useMemo(() => {
    const pMax = posMax.trim() ? Number(posMax) : null;
    const iMin = imprMin.trim() ? Number(imprMin) : null;
    const m = new Map<string, KwPageRow[]>();
    for (const r of rows || []) {
      if (pMax != null && !(r.position <= pMax)) continue;
      if (iMin != null && !(r.impressions >= iMin)) continue;
      if (!m.has(r.page)) m.set(r.page, []);
      m.get(r.page)!.push(r);
    }
    return m;
  }, [rows, posMax, imprMin]);

  // How many distinct pages a term ranks on (for the cannibalization marker, item f).
  const termPageCount = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of rows || []) { if (!m.has(r.term)) m.set(r.term, new Set()); m.get(r.term)!.add(norm(r.page)); }
    return m;
  }, [rows]);

  const targetKwByPage = useMemo(() => {
    const m = new Map<string, KeywordTarget[]>();
    for (const t of targets || []) {
      if (t.status === "parked") continue;
      if (t.page_url && t.intent !== "new_page") { const k = norm(t.page_url); if (!m.has(k)) m.set(k, []); m.get(k)!.push(t); }
    }
    return m;
  }, [targets]);
  const secondaryByPage = useMemo(() => {
    const m = new Map<string, PageKeyword[]>();
    for (const pk of pageKws || []) { const k = norm(pk.page_url); if (!m.has(k)) m.set(k, []); m.get(k)!.push(pk); }
    return m;
  }, [pageKws]);
  const parked = (targets || []).filter((t) => t.status === "parked");
  const titleByPage = useMemo(() => { const m = new Map<string, string>(); for (const c of crawled || []) if (c.title) m.set(norm(c.url), c.title); return m; }, [crawled]);

  // Master list of pages: crawled ∪ GSC ∪ chosen target pages.
  const pages = useMemo(() => {
    const urls = new Map<string, string>(); // norm -> display url
    for (const c of crawled || []) urls.set(norm(c.url), c.url);
    for (const p of byPage.keys()) if (!urls.has(norm(p))) urls.set(norm(p), p);
    for (const t of targets || []) if (t.page_url && t.intent !== "new_page" && !urls.has(norm(t.page_url))) urls.set(norm(t.page_url), t.page_url);
    for (const pk of pageKws || []) if (!urls.has(norm(pk.page_url))) urls.set(norm(pk.page_url), pk.page_url);
    let list = [...urls.values()];
    if (q.trim()) { const s = q.trim().toLowerCase(); list = list.filter((u) => decodePath(u).toLowerCase().includes(s) || (byPage.get(u) || []).some((r) => r.term.toLowerCase().includes(s))); }
    const impr = (u: string) => (byPage.get(u) || []).reduce((s, r) => s + r.impressions, 0);
    const hasTarget = (u: string) => (targetKwByPage.get(norm(u))?.length || 0) > 0;
    return list.sort((a, b) => (hasTarget(b) ? 1 : 0) - (hasTarget(a) ? 1 : 0) || impr(b) - impr(a));
  }, [crawled, byPage, targets, pageKws, q, targetKwByPage]);

  const allPageUrls = useMemo(() => pages.map((u) => u), [pages]);
  const sortRows = (arr: KwPageRow[]) => {
    const dir = sortDesc ? 1 : -1;
    return [...arr].sort((a, b) => {
      const va = sortMetric === "impr" ? a.impressions : sortMetric === "clicks" ? a.clicks : a.position;
      const vb = sortMetric === "impr" ? b.impressions : sortMetric === "clicks" ? b.clicks : b.position;
      // position: lower is better, so "high→low" means best-first → ascending position
      return sortMetric === "pos" ? (va - vb) * dir : (vb - va) * dir;
    });
  };

  return (
    <div>
      <PageHeader title="עמודי יעד וביטויי משנה" subtitle={client ? `${client.name} · ניהול הביטויים של כל עמוד` : "עמודי יעד וביטויי משנה"} />
      <DataSourceBanner cid={cid} match={["Search Console"]} />

      {/* Parked keywords ("שים בצד") */}
      {parked.length > 0 && (
        <div className="card mb-4 border-r-4 border-r-slate-300">
          <button className="w-full flex items-center justify-between gap-2 text-right" onClick={() => setParkedOpen((o) => !o)}>
            <h3 className="font-semibold flex items-center gap-2 text-slate-700"><PauseCircle size={17} className="text-slate-400" /> ביטויים בצד (ממתינים להחלטה) <span className="text-xs font-normal text-slate-400">({parked.length})</span></h3>
            {parkedOpen ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
          </button>
          {parkedOpen && (
            <ul className="mt-3 space-y-1.5">
              {parked.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2">
                  <span className="font-medium text-slate-700">{t.keyword}</span>
                  <div className="flex items-center gap-1.5">
                    <select className="input py-1 text-xs w-auto max-w-[220px]" defaultValue="" onChange={(e) => { if (e.target.value) move.mutate({ kw: t.keyword, page: e.target.value }); }}>
                      <option value="">צרף לעמוד…</option>
                      {allPageUrls.map((u) => <option key={u} value={u}>{decodePath(u)}</option>)}
                    </select>
                    <button className="text-slate-400 hover:text-rose-600 p-1" title="הסר מהצד" onClick={() => delTarget.mutate(t.id)}><X size={14} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="card mb-4">
        <p className="text-sm text-slate-600 mb-3">
          כל עמוד באתר עם כל הביטויים שהוא מדורג עליהם. בשורה הראשונה מופיע <b className="text-emerald-700">ביטוי היעד</b> שהוגדר בלשונית "ביטויי יעד ועמודי יעד",
          ומתחתיו <b className="text-blue-700">ביטויי המשנה</b> שבחרת. הוסף ביטויי משנה כדי שהעמוד יתחרה גם עליהם — זה נשמר ומוזן לתכנית העבודה, הצעות התוכן והבלוג.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="block text-xs text-slate-500 mb-1">מתאריך</label><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="block text-xs text-slate-500 mb-1">עד תאריך</label><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>{isFetching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} רענן</button>
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : pages.length === 0 ? (
        <div className="card text-center py-10 text-slate-500 text-sm">
          <Layers size={36} className="mx-auto mb-2 text-slate-300" />
          אין עדיין עמודים. ודא שהלקוח מחובר ל-Search Console וסונכרן, או הרץ סריקת אתר (לשונית "עמודים").
        </div>
      ) : (
        <>
          {/* Toolbar: sort + filters + search */}
          <div className="card mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500">מיין לפי</span>
              <select className="input py-1 text-sm w-auto" value={sortMetric} onChange={(e) => setSortMetric(e.target.value as SortMetric)}>
                <option value="impr">חשיפות</option>
                <option value="clicks">קליקים</option>
                <option value="pos">מיקום</option>
              </select>
              <button className="btn-secondary text-xs py-1 px-2" onClick={() => setSortDesc((d) => !d)} title="הפוך סדר">
                <ArrowUpDown size={13} /> {sortDesc ? "גבוה→נמוך" : "נמוך→גבוה"}
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-slate-500 inline-flex items-center gap-1">מיקום עד<input type="number" min={1} className="input py-1 text-sm w-16" placeholder="∞" value={posMax} onChange={(e) => setPosMax(e.target.value)} /></label>
              <label className="text-xs text-slate-500 inline-flex items-center gap-1">חשיפות מ-<input type="number" min={0} className="input py-1 text-sm w-20" placeholder="0" value={imprMin} onChange={(e) => setImprMin(e.target.value)} /></label>
              {(posMax || imprMin) && <button className="text-xs text-slate-400 hover:text-rose-600" onClick={() => { setPosMax(""); setImprMin(""); }}>נקה</button>}
              <div className="relative">
                <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input py-1 text-sm pr-7 w-52" placeholder="חפש עמוד / ביטוי" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {pages.map((page) => {
              const nk = norm(page);
              const gsc = byPage.get(page) || [];
              const targetKws = (targetKwByPage.get(nk) || []).map((t) => t.keyword);
              const targetSet = new Set(targetKws);
              const secondary = secondaryByPage.get(nk) || [];
              const secSet = new Set(secondary.map((s) => s.keyword));
              const gscByTerm = new Map(gsc.map((r) => [r.term, r] as const));
              // Rows that are NOT target and NOT secondary (candidate keywords on the page).
              const otherRows = sortRows(gsc.filter((r) => !targetSet.has(r.term) && !secSet.has(r.term)));
              const totalImpr = gsc.reduce((s, r) => s + r.impressions, 0);
              const totalClicks = gsc.reduce((s, r) => s + r.clicks, 0);
              const title = titleByPage.get(nk);
              const isOpen = open[nk] ?? true;
              const metaRow = (term: string) => gscByTerm.get(term);
              return (
                <div key={page} className="card">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <button className="flex items-center gap-1.5 text-right min-w-0" onClick={() => setOpen((o) => ({ ...o, [nk]: !isOpen }))}>
                        {isOpen ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
                        <span className="font-semibold text-slate-900 truncate">{title || decodePath(page)}</span>
                      </button>
                      <a href={page} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1 min-w-0 mt-0.5"><ExternalLink size={11} className="shrink-0" /><span className="truncate">{decodePath(page)}</span></a>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">{gsc.length} ביטויים · {totalImpr.toLocaleString()} חשיפות · {totalClicks.toLocaleString()} קליקים</span>
                  </div>

                  {isOpen && (
                    <>
                      {/* Pinned: target + secondary keywords */}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {targetKws.length === 0 && secondary.length === 0 && <span className="text-xs text-slate-400">לא הוגדר ביטוי יעד לעמוד זה. הגדר אותו בלשונית "ביטויי יעד ועמודי יעד".</span>}
                        {targetKws.map((kw) => {
                          const r = metaRow(kw); const elsewhere = (termPageCount.get(kw)?.size || 0) > 1;
                          return (
                            <span key={kw} className="badge bg-emerald-50 text-emerald-700 inline-flex items-center gap-1" title="ביטוי יעד">
                              <Target size={11} /> {kw}
                              {r && <span className="text-emerald-500/80">· מ' {r.position} · {r.impressions.toLocaleString()} ח'</span>}
                              {elsewhere && <span className="badge bg-amber-100 text-amber-700 ml-1">גם בעמודים אחרים</span>}
                            </span>
                          );
                        })}
                        {secondary.map((s) => {
                          const r = metaRow(s.keyword);
                          return (
                            <span key={s.id} className="badge bg-blue-50 text-blue-700 inline-flex items-center gap-1" title="ביטוי משנה">
                              {s.keyword}{r && <span className="text-blue-400">· מ' {r.position} · {r.impressions.toLocaleString()} ח'</span>}
                              <button className="text-blue-400 hover:text-rose-600" title="הסר ביטוי משנה" onClick={() => removeSecondary.mutate(s.id)}><X size={11} /></button>
                            </span>
                          );
                        })}
                      </div>

                      {/* All ranking keywords with per-keyword actions */}
                      {otherRows.length > 0 ? (
                        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 pt-1">
                          {otherRows.map((r) => {
                            const elsewhere = (termPageCount.get(r.term)?.size || 0) > 1;
                            return (
                              <li key={r.term} className="py-1.5 flex items-center justify-between gap-2 flex-wrap">
                                <span className="text-sm text-slate-700 inline-flex items-center gap-1.5 min-w-0">
                                  <span className="truncate">{r.term}</span>
                                  {elsewhere && <span className="badge bg-amber-50 text-amber-600">גם בעמודים אחרים</span>}
                                </span>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs text-slate-400 shrink-0">מ' {r.position} · {r.impressions.toLocaleString()} ח' · {r.clicks.toLocaleString()} ק'</span>
                                  <button className="btn-secondary text-xs py-0.5 px-2 border-blue-200 text-blue-700" onClick={() => addSecondary.mutate({ page, kw: r.term })} title="הוסף כביטוי משנה לעמוד זה"><Plus size={12} /> ביטוי משנה</button>
                                  <button className="btn-secondary text-xs py-0.5 px-2" onClick={() => newPage.mutate(r.term)} title="דורש עמוד חדש ייעודי"><FilePlus size={12} /> עמוד חדש</button>
                                  <select className="input py-0.5 text-xs w-auto max-w-[150px]" defaultValue="" onChange={(e) => { if (e.target.value) move.mutate({ kw: r.term, page: e.target.value }); }} title="העבר לעמוד אחר">
                                    <option value="">העבר לעמוד…</option>
                                    {allPageUrls.filter((u) => norm(u) !== nk).map((u) => <option key={u} value={u}>{decodePath(u)}</option>)}
                                  </select>
                                  <button className="text-slate-400 hover:text-slate-700 text-xs inline-flex items-center gap-0.5" onClick={() => park.mutate(r.term)} title="שים בצד"><PauseCircle size={13} /> בצד</button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        gsc.length === 0 && <p className="text-xs text-slate-400 mt-3"><FileText size={12} className="inline" /> אין נתוני דירוג מ-Search Console לעמוד זה בטווח שנבחר.</p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
