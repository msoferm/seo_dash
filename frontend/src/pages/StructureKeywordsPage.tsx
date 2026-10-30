import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, Search, ExternalLink, AlertTriangle, Check, X, Loader2, Save, Target } from "lucide-react";
import * as api from "../api";
import type { KwPageRow, KeywordTarget } from "../api";
import PageHeader from "../components/PageHeader";
import DataSourceBanner from "../components/DataSourceBanner";
import Spinner from "../components/Spinner";

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function decodePath(u: string): string {
  try { return decodeURIComponent(u.replace(/^https?:\/\/[^/]+/, "")) || u; } catch { return u; }
}

/** #3: per-keyword target editor — choose the page that should own this keyword (or a new page). */
function TargetEditor({ cid, term, pages, saved, onSaved }: { cid: number; term: string; pages: string[]; saved?: KeywordTarget; onSaved: () => void }) {
  const NEW = "__new__";
  const initSel = saved ? (saved.intent === "new_page" ? NEW : (saved.page_url || NEW)) : (pages[0] || NEW);
  const [sel, setSel] = useState<string>(initSel);
  const [newUrl, setNewUrl] = useState<string>(saved?.intent === "new_page" ? (saved.page_url || "") : "");
  const save = useMutation({
    mutationFn: () => {
      if (sel === NEW) return api.upsertKeywordTarget(cid, { keyword: term, page_url: newUrl.trim() || null, intent: "new_page" });
      return api.upsertKeywordTarget(cid, { keyword: term, page_url: sel, intent: "strengthen" });
    },
    onSuccess: onSaved,
  });
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 bg-slate-50 rounded-lg p-2">
      <Target size={14} className="text-brand-600 shrink-0" />
      <span className="text-xs text-slate-500">עמוד יעד:</span>
      <select className="input py-1 text-xs w-auto max-w-[260px]" value={sel} onChange={(e) => setSel(e.target.value)}>
        {pages.map((p) => <option key={p} value={p}>{decodePath(p)}</option>)}
        <option value={NEW}>➕ עמוד חדש (לכתוב מאמר)</option>
      </select>
      {sel === NEW && (
        <input className="input py-1 text-xs w-56" placeholder="כתובת עמוד חדש (אופציונלי)" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
      )}
      <button className="btn-primary text-xs py-1 px-2" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} שמור יעד
      </button>
      {save.isSuccess && <span className="text-xs text-emerald-600">נשמר ✓</span>}
      {save.isError && <span className="text-xs text-rose-600">{(save.error as any)?.message}</span>}
    </div>
  );
}

export default function StructureKeywordsPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();

  const today = new Date();
  const [from, setFrom] = useState(fmt(new Date(today.getTime() - 90 * 86400000)));
  const [to, setTo] = useState(fmt(today));
  const [view, setView] = useState<"keyword" | "page">("keyword");
  const [q, setQ] = useState("");
  const [onlyCannibal, setOnlyCannibal] = useState(false);

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: rows, isLoading, refetch, isFetching } = useQuery({ queryKey: ["kw-map", cid, from, to], queryFn: () => api.getKeywordPageMap(cid, from, to), enabled: !!cid });
  const { data: targets } = useQuery({ queryKey: ["kw-targets", cid], queryFn: () => api.listKeywordTargets(cid), enabled: !!cid });
  const invalidateTargets = () => qc.invalidateQueries({ queryKey: ["kw-targets", cid] });
  const delTarget = useMutation({ mutationFn: (id: number) => api.deleteKeywordTarget(id), onSuccess: invalidateTargets });

  const targetByTerm = useMemo(() => {
    const m = new Map<string, KeywordTarget>();
    for (const t of targets || []) m.set(t.keyword, t);
    return m;
  }, [targets]);

  // term -> its ranking pages (desc by impressions); page -> its ranking terms.
  const { byTerm, byPage } = useMemo(() => {
    const bt = new Map<string, KwPageRow[]>();
    const bp = new Map<string, KwPageRow[]>();
    for (const r of rows || []) {
      if (!bt.has(r.term)) bt.set(r.term, []);
      bt.get(r.term)!.push(r);
      if (!bp.has(r.page)) bp.set(r.page, []);
      bp.get(r.page)!.push(r);
    }
    for (const arr of bt.values()) arr.sort((a, b) => b.impressions - a.impressions);
    for (const arr of bp.values()) arr.sort((a, b) => b.impressions - a.impressions);
    return { byTerm: bt, byPage: bp };
  }, [rows]);

  const termList = useMemo(() => {
    let list = [...byTerm.entries()];
    if (onlyCannibal) list = list.filter(([, pgs]) => pgs.length >= 2);
    if (q.trim()) { const s = q.trim().toLowerCase(); list = list.filter(([t]) => t.toLowerCase().includes(s)); }
    return list.sort((a, b) => b[1].reduce((s, r) => s + r.impressions, 0) - a[1].reduce((s, r) => s + r.impressions, 0));
  }, [byTerm, onlyCannibal, q]);

  const pageList = useMemo(() => {
    let list = [...byPage.entries()];
    if (q.trim()) { const s = q.trim().toLowerCase(); list = list.filter(([p, terms]) => p.toLowerCase().includes(s) || terms.some((r) => r.term.toLowerCase().includes(s))); }
    return list.sort((a, b) => b[1].reduce((s, r) => s + r.impressions, 0) - a[1].reduce((s, r) => s + r.impressions, 0));
  }, [byPage, q]);

  const cannibalCount = [...byTerm.values()].filter((p) => p.length >= 2).length;

  return (
    <div>
      <PageHeader title="אופטימיזציית מבנה ומילות מפתח" subtitle={client ? `${client.name} · איזה ביטוי שייך לאיזה עמוד` : "מבנה ומילות מפתח"} />
      <DataSourceBanner cid={cid} match={["Search Console"]} />

      <div className="card mb-4">
        <p className="text-sm text-slate-600 mb-3">
          התמונה המלאה: איזה ביטויים מדורגים על איזה עמודים, כמה ביטויים לכל עמוד, והיכן יש קניבליזציה (אותו ביטוי על כמה עמודים).
          הגדר לכל ביטוי את <b>עמוד היעד</b> — והלשוניות האחרות (מנוע המלצות וכו') יסתנכרנו אליו.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">מתאריך</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">עד תאריך</label>
            <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} רענן נתונים
          </button>
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : (rows || []).length === 0 ? (
        <div className="card text-center py-10 text-slate-500 text-sm">
          <Network size={36} className="mx-auto mb-2 text-slate-300" />
          אין נתוני Search Console בטווח שנבחר. ודא שהלקוח מחובר ל-GSC וסונכרן, או הרחב את טווח התאריכים.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Tile label="ביטויים" value={byTerm.size} />
            <Tile label="עמודים" value={byPage.size} />
            <Tile label="ביטויים בקניבליזציה" value={cannibalCount} alert={cannibalCount > 0} />
          </div>

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                <button className={`px-3 py-1.5 text-sm ${view === "keyword" ? "bg-brand-600 text-white" : "text-slate-600"}`} onClick={() => setView("keyword")}>לפי ביטוי</button>
                <button className={`px-3 py-1.5 text-sm ${view === "page" ? "bg-brand-600 text-white" : "text-slate-600"}`} onClick={() => setView("page")}>לפי עמוד</button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {view === "keyword" && (
                  <label className="text-xs text-slate-500 inline-flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={onlyCannibal} onChange={(e) => setOnlyCannibal(e.target.checked)} /> רק קניבליזציה
                  </label>
                )}
                <div className="relative">
                  <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="input py-1 text-sm pr-7 w-52" placeholder="חפש ביטוי/עמוד" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
              </div>
            </div>

            {view === "keyword" ? (
              <div className="space-y-3">
                {termList.map(([term, pgs]) => {
                  const total = pgs.reduce((s, r) => s + r.impressions, 0);
                  const clicks = pgs.reduce((s, r) => s + r.clicks, 0);
                  const cannibal = pgs.length >= 2;
                  const saved = targetByTerm.get(term);
                  return (
                    <div key={term} className="border border-slate-200 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="font-medium text-slate-900 flex items-center gap-2">
                          {term}
                          {cannibal && <span className="badge bg-rose-50 text-rose-600 inline-flex items-center gap-1"><AlertTriangle size={11} /> {pgs.length} עמודים</span>}
                        </div>
                        <div className="text-xs text-slate-400">{total} חשיפות · {clicks} קליקים</div>
                      </div>
                      <ul className="mt-2 divide-y divide-slate-100">
                        {pgs.map((r) => (
                          <li key={r.page} className="py-1 flex items-center justify-between gap-2 text-sm">
                            <a href={r.page} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline truncate inline-flex items-center gap-1 min-w-0"><ExternalLink size={11} className="shrink-0" /><span className="truncate">{decodePath(r.page)}</span></a>
                            <span className="text-xs text-slate-400 shrink-0">מיקום {r.position} · {r.impressions} חשיפות</span>
                          </li>
                        ))}
                      </ul>
                      {saved && (
                        <div className="mt-2 text-xs inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 rounded px-2 py-1">
                          <Check size={12} /> יעד מוגדר: {saved.intent === "new_page" ? `עמוד חדש${saved.page_url ? ` (${decodePath(saved.page_url)})` : ""}` : decodePath(saved.page_url || "")}
                          <button className="text-emerald-600 hover:text-rose-600 mr-1" title="הסר יעד" onClick={() => delTarget.mutate(saved.id)}><X size={12} /></button>
                        </div>
                      )}
                      <TargetEditor cid={cid} term={term} pages={pgs.map((r) => r.page)} saved={saved} onSaved={invalidateTargets} />
                    </div>
                  );
                })}
                {termList.length === 0 && <p className="text-slate-400 text-sm">לא נמצאו ביטויים.</p>}
              </div>
            ) : (
              <div className="space-y-3">
                {pageList.map(([page, terms]) => {
                  const total = terms.reduce((s, r) => s + r.impressions, 0);
                  const clicks = terms.reduce((s, r) => s + r.clicks, 0);
                  return (
                    <div key={page} className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="bg-slate-50 px-3 py-2 flex items-center justify-between gap-2">
                        <a href={page} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-700 hover:underline truncate inline-flex items-center gap-1 min-w-0"><ExternalLink size={12} className="shrink-0" /><span className="truncate">{decodePath(page)}</span></a>
                        <span className="text-xs text-slate-400 shrink-0">{terms.length} ביטויים · {total} חשיפות · {clicks} קליקים</span>
                      </div>
                      <ul className="divide-y divide-slate-100">
                        {terms.map((r) => (
                          <li key={r.term} className="px-3 py-1.5 flex items-center justify-between gap-2 text-sm">
                            <span className="text-slate-700 truncate">{r.term}</span>
                            <span className="text-xs text-slate-400 shrink-0">מיקום {r.position} · {r.impressions} חשיפות · {r.clicks} קליקים</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
                {pageList.length === 0 && <p className="text-slate-400 text-sm">לא נמצאו עמודים.</p>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={`card py-3 text-center ${alert ? "border-rose-200 bg-rose-50/40" : ""}`}>
      <div className={`text-2xl font-bold ${alert ? "text-rose-600" : "text-slate-900"}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
