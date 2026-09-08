import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutList, ExternalLink, Loader2, Radar } from "lucide-react";
import * as api from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import DateRangePicker, { rangeForDays } from "../components/DateRangePicker";

function norm(u: string): string { return (u || "").replace(/\/+$/, "").toLowerCase(); }
function scoreColor(s: number): string { return s >= 75 ? "text-emerald-600" : s >= 50 ? "text-amber-600" : "text-rose-600"; }
const TYPE_LABEL: Record<string, string> = { service: "שירות", article: "מאמר", product: "מוצר", category: "קטגוריה", about: "אודות", page: "עמוד", post: "מאמר" };

function seoScore(clicks: number, position: number, issues: number, opps: number): number {
  let s = 55;
  if (position > 0) { if (position <= 3) s += 28; else if (position <= 10) s += 18; else if (position <= 20) s += 6; else s -= 6; }
  s += Math.min(15, Math.round(Math.log10(clicks + 1) * 8));
  s -= issues * 6; s -= opps * 2;
  return Math.max(0, Math.min(100, Math.round(s)));
}

type SortKey = "clicks" | "impressions" | "position" | "score" | "opps";

export default function PagesMasterPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const [range, setRange] = useState(() => rangeForDays(90));
  const [sort, setSort] = useState<SortKey>("clicks");
  const [polling, setPolling] = useState(false);

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: stats, isLoading } = useQuery({ queryKey: ["page-stats", cid, range], queryFn: () => api.getPageStats(cid, range.from, range.to), enabled: !!cid });
  const { data: crawled } = useQuery({ queryKey: ["crawled", cid], queryFn: () => api.listCrawledPages(cid), enabled: !!cid, refetchInterval: polling ? 8000 : false });
  const { data: recs } = useQuery({ queryKey: ["recs", cid], queryFn: () => api.listRecommendations(cid), enabled: !!cid });
  const { data: issues } = useQuery({ queryKey: ["audit-issues", cid], queryFn: () => api.listAuditIssues(cid), enabled: !!cid });

  const crawl = useMutation({
    mutationFn: () => api.runSiteCrawl(cid),
    onSuccess: () => { setPolling(true); setTimeout(() => setPolling(false), 120000); qc.invalidateQueries({ queryKey: ["crawled", cid] }); },
  });

  const oppByPage = new Map<string, number>();
  for (const r of recs || []) if (r.page && r.status === "pending") oppByPage.set(norm(r.page), (oppByPage.get(norm(r.page)) || 0) + 1);
  const auditByPage = new Map<string, number>();
  for (const i of issues || []) if (i.page && i.status === "pending") auditByPage.set(norm(i.page), (auditByPage.get(norm(i.page)) || 0) + 1);
  const crawlMap = new Map<string, api.CrawledPage>();
  for (const c of crawled || []) crawlMap.set(norm(c.url), c);
  const statMap = new Map<string, api.PageStat>();
  for (const p of stats || []) statMap.set(norm(p.page), p);

  // union of crawled + gsc pages
  const urls = new Set<string>([...(crawled || []).map((c) => c.url), ...(stats || []).map((s) => s.page)]);
  const rows = [...urls].map((url) => {
    const k = norm(url);
    const st = statMap.get(k);
    const c = crawlMap.get(k);
    const crawlIssues = c ? ((c.meta_description ? 0 : 1) + (c.h1 ? 0 : 1) + ((c.images_missing_alt || 0) > 0 ? 1 : 0) + ((c.word_count || 999) < 250 ? 1 : 0)) : 0;
    const iss = (auditByPage.get(k) || 0) + crawlIssues;
    const opp = oppByPage.get(k) || 0;
    const clicks = st?.clicks || 0, impressions = st?.impressions || 0, ctr = st?.ctr || 0, position = st?.position || 0;
    return { url, clicks, impressions, ctr, position, page_type: c?.page_type || null, words: c?.word_count ?? null, issues: iss, opps: opp, score: seoScore(clicks, position, iss, opp) };
  });
  rows.sort((a, b) => sort === "position" ? (a.position || 999) - (b.position || 999) : (b as any)[sort] - (a as any)[sort]);
  const lastCrawl = (crawled || [])[0]?.last_full_crawl;

  const Th = ({ k, label, num = true }: { k?: SortKey; label: string; num?: boolean }) => (
    <th className={`p-2 font-medium ${num ? "text-center" : "text-right"} ${k ? "cursor-pointer hover:text-brand-600 select-none" : ""}`} onClick={() => k && setSort(k)}>{label}{k && sort === k ? " ↓" : ""}</th>
  );

  return (
    <div>
      <PageHeader
        title="עמודים — תמונת מצב"
        subtitle={client ? `${client.name} · ביצועים, ציון SEO, בעיות והזדמנויות לכל עמוד` : "כל עמודי האתר"}
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <button className="btn-secondary" onClick={() => crawl.mutate()} disabled={crawl.isPending || polling} title="סורק את כל עמודי ה-WordPress ומעדכן נתונים מבניים">
              {crawl.isPending || polling ? <Loader2 size={18} className="animate-spin" /> : <Radar size={18} />} {polling ? "סורק..." : "סרוק אתר"}
            </button>
          </>
        }
      />
      {crawl.isError && <div className="mb-3 text-sm text-rose-600">{(crawl.error as any)?.message}</div>}
      {polling && <div className="mb-3 text-sm text-brand-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> הסריקה רצה ברקע — העמודים והנתונים המבניים יתעדכנו כאן בהדרגה.</div>}
      {lastCrawl && !polling && <div className="mb-3 text-xs text-slate-400">נסרק לאחרונה: {new Date(lastCrawl).toLocaleString("he-IL")} · {(crawled || []).length} עמודים</div>}

      <div className="card">
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm"><LayoutList size={36} className="mx-auto mb-2 text-slate-300" />אין נתוני עמודים. סנכרן GSC או לחץ "סרוק אתר".</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[820px]">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <Th label="עמוד" num={false} />
                  <Th label="סוג" />
                  <Th k="clicks" label="קליקים" />
                  <Th k="impressions" label="חשיפות" />
                  <Th label="CTR" />
                  <Th k="position" label="מיקום" />
                  <Th k="score" label="ציון SEO" />
                  <Th label="בעיות" />
                  <Th k="opps" label="הזדמנויות" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.url} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="text-right p-2 max-w-[260px]"><a href={r.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-1 truncate"><ExternalLink size={12} className="shrink-0" /><span className="truncate">{r.url.replace(/^https?:\/\/[^/]+/, "") || r.url}</span></a></td>
                    <td className="text-center p-2">{r.page_type ? <span className="badge bg-slate-100 text-slate-600">{TYPE_LABEL[r.page_type] || r.page_type}</span> : <span className="text-slate-300 text-xs">—</span>}</td>
                    <td className="text-center p-2 font-medium text-slate-900 tabular-nums">{r.clicks.toLocaleString()}</td>
                    <td className="text-center p-2 text-slate-600 tabular-nums">{r.impressions.toLocaleString()}</td>
                    <td className="text-center p-2 text-slate-500 tabular-nums">{(r.ctr * 100).toFixed(1)}%</td>
                    <td className="text-center p-2 text-slate-700 tabular-nums">{r.position > 0 ? r.position : "—"}</td>
                    <td className={`text-center p-2 font-bold tabular-nums ${scoreColor(r.score)}`}>{r.score}</td>
                    <td className="text-center p-2">{r.issues > 0 ? <span className="badge bg-rose-50 text-rose-700">{r.issues}</span> : <span className="text-slate-300">0</span>}</td>
                    <td className="text-center p-2">{r.opps > 0 ? <span className="badge bg-emerald-50 text-emerald-700">{r.opps}</span> : <span className="text-slate-300">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-400 mt-3">"סרוק אתר" מושך את כל עמודי ה-WordPress ומחשב סוג עמוד, מבנה ובעיות מבניות (מטא/H1/alt/תוכן דל). ציון ה-SEO משלב מיקום, תנועה ובעיות/הזדמנויות פתוחות. לחץ על כותרת עמודה למיון.</p>
      </div>
    </div>
  );
}
