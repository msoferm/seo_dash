import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, ExternalLink, TrendingUp, TrendingDown, Minus } from "lucide-react";
import * as api from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import { rangeForDays } from "../components/DateRangePicker";

function norm(u: string): string { return (u || "").replace(/\/+$/, "").toLowerCase(); }

export default function ImpactPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const range = rangeForDays(30);

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: recs, isLoading } = useQuery({ queryKey: ["recs", cid], queryFn: () => api.listRecommendations(cid), enabled: !!cid });
  const { data: stats } = useQuery({ queryKey: ["page-stats", cid, range], queryFn: () => api.getPageStats(cid, range.from, range.to), enabled: !!cid });

  const nowByPage = new Map<string, number>();
  for (const p of stats || []) nowByPage.set(norm(p.page), p.clicks);

  const done = (recs || []).filter((r) => (r.status === "applied" || r.status === "done") && r.applied_at)
    .sort((a, b) => (b.applied_at || "").localeCompare(a.applied_at || ""));

  return (
    <div>
      <PageHeader title="מעקב השפעה" subtitle={client ? `${client.name} · מה שבוצע וההשפעה בפועל` : "מעקב השפעה"} />
      <div className="card">
        {isLoading ? (
          <Spinner />
        ) : done.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm"><Activity size={36} className="mx-auto mb-2 text-slate-300" />עדיין לא בוצעו המלצות. בצע המלצות ב"מנוע המלצות" והן יופיעו כאן עם ההשפעה.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[720px]">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <th className="text-right p-2 font-medium">מה בוצע</th>
                  <th className="text-right p-2 font-medium">עמוד</th>
                  <th className="p-2 font-medium">כניסות לפני</th>
                  <th className="p-2 font-medium">כניסות עכשיו</th>
                  <th className="p-2 font-medium">שינוי</th>
                  <th className="p-2 font-medium">תאריך</th>
                </tr>
              </thead>
              <tbody>
                {done.map((r) => {
                  const before = r.clicks_before;
                  const now = r.page ? nowByPage.get(norm(r.page)) : undefined;
                  const hasBoth = before != null && now != null;
                  const delta = hasBoth ? (now as number) - (before as number) : null;
                  return (
                    <tr key={r.id} className="border-b border-slate-100 align-top">
                      <td className="text-right p-2">
                        <div className="font-medium text-slate-900">{r.title}</div>
                        {r.applied_note && <div className="text-xs text-slate-400">{r.applied_note}</div>}
                      </td>
                      <td className="text-right p-2">{r.page ? <a href={r.page} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-1 text-xs break-all"><ExternalLink size={11} className="shrink-0" />{r.page.replace(/^https?:\/\/[^/]+/, "") || r.page}</a> : <span className="text-slate-400 text-xs">—</span>}</td>
                      <td className="text-center p-2 tabular-nums text-slate-600">{before ?? "—"}</td>
                      <td className="text-center p-2 tabular-nums text-slate-900 font-medium">{now ?? "—"}</td>
                      <td className="text-center p-2 tabular-nums">
                        {delta == null ? <span className="text-slate-300">—</span>
                          : delta > 0 ? <span className="text-emerald-600 inline-flex items-center gap-0.5"><TrendingUp size={13} />+{delta}</span>
                          : delta < 0 ? <span className="text-rose-600 inline-flex items-center gap-0.5"><TrendingDown size={13} />{delta}</span>
                          : <span className="text-slate-400 inline-flex items-center"><Minus size={13} /></span>}
                      </td>
                      <td className="text-center p-2 text-xs text-slate-400 whitespace-nowrap">{r.applied_at ? new Date(r.applied_at).toLocaleDateString("he-IL") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-400 mt-3">"כניסות לפני" נלכד בזמן הביצוע; "כניסות עכשיו" מ-30 הימים האחרונים. ההשפעה מתבססת לאורך זמן ככל שגוגל מעדכן — כדאי לבדוק שוב אחרי 2-4 שבועות.</p>
      </div>
    </div>
  );
}
