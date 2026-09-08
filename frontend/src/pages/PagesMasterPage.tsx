import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutList, ExternalLink } from "lucide-react";
import * as api from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import DateRangePicker, { rangeForDays } from "../components/DateRangePicker";

function norm(u: string): string { return (u || "").replace(/\/+$/, "").toLowerCase(); }
function scoreColor(s: number): string { return s >= 75 ? "text-emerald-600" : s >= 50 ? "text-amber-600" : "text-rose-600"; }

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
  const [range, setRange] = useState(() => rangeForDays(90));
  const [sort, setSort] = useState<SortKey>("clicks");

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: stats, isLoading } = useQuery({ queryKey: ["page-stats", cid, range], queryFn: () => api.getPageStats(cid, range.from, range.to), enabled: !!cid });
  const { data: recs } = useQuery({ queryKey: ["recs", cid], queryFn: () => api.listRecommendations(cid), enabled: !!cid });
  const { data: issues } = useQuery({ queryKey: ["audit-issues", cid], queryFn: () => api.listAuditIssues(cid), enabled: !!cid });

  const oppByPage = new Map<string, number>();
  for (const r of recs || []) if (r.page && r.status === "pending") oppByPage.set(norm(r.page), (oppByPage.get(norm(r.page)) || 0) + 1);
  const issueByPage = new Map<string, number>();
  for (const i of issues || []) if (i.page && i.status === "pending") issueByPage.set(norm(i.page), (issueByPage.get(norm(i.page)) || 0) + 1);

  const rows = (stats || []).map((p) => {
    const iss = issueByPage.get(norm(p.page)) || 0;
    const opp = oppByPage.get(norm(p.page)) || 0;
    return { ...p, issues: iss, opps: opp, score: seoScore(p.clicks, p.position, iss, opp) };
  });
  rows.sort((a, b) => sort === "position" ? (a.position || 999) - (b.position || 999) : (b as any)[sort] - (a as any)[sort]);

  const Th = ({ k, label, num = true }: { k?: SortKey; label: string; num?: boolean }) => (
    <th className={`p-2 font-medium ${num ? "text-center" : "text-right"} ${k ? "cursor-pointer hover:text-brand-600 select-none" : ""}`} onClick={() => k && setSort(k)}>
      {label}{k && sort === k ? " ↓" : ""}
    </th>
  );

  return (
    <div>
      <PageHeader
        title="עמודים — תמונת מצב"
        subtitle={client ? `${client.name} · ביצועים, ציון SEO, בעיות והזדמנויות לכל עמוד` : "כל עמודי האתר"}
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />
      <div className="card">
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm"><LayoutList size={36} className="mx-auto mb-2 text-slate-300" />אין נתוני עמודים. סנכרן GSC תחילה.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <Th label="עמוד" num={false} />
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
                  <tr key={r.page} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="text-right p-2 max-w-[280px]"><a href={r.page} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-1 truncate"><ExternalLink size={12} className="shrink-0" /><span className="truncate">{r.page.replace(/^https?:\/\/[^/]+/, "") || r.page}</span></a></td>
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
        <p className="text-xs text-slate-400 mt-3">ציון ה-SEO מחושב ממיקום, תנועה, ומספר הבעיות/ההזדמנויות הפתוחות. לחץ על כותרת עמודה למיון. הזדמנויות נספרות מ"מנוע המלצות" ובעיות מ"כלי SEO".</p>
      </div>
    </div>
  );
}
