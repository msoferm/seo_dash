import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search, TrendingUp, TrendingDown, Minus, ExternalLink } from "lucide-react";
import * as api from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import RankBucketsChart from "../components/RankBucketsChart";

function RankDelta({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null) return <span className="text-slate-400 text-xs">—</span>;
  const delta = previous - current; // higher position number = worse, so positive delta = improvement
  if (delta === 0) return <Minus size={14} className="inline text-slate-400" />;
  if (delta > 0) return <span className="text-emerald-600 text-xs inline-flex items-center"><TrendingUp size={12} /> {delta}</span>;
  return <span className="text-rose-600 text-xs inline-flex items-center"><TrendingDown size={12} /> {Math.abs(delta)}</span>;
}

export default function RankingsPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: client } = useQuery({
    queryKey: ["client", cid],
    queryFn: () => api.getClient(cid),
  });
  const { data: keywords, isLoading } = useQuery({
    queryKey: ["zefo-keywords", cid, search],
    queryFn: () => api.listZefoKeywords(cid, search || undefined),
  });

  const sync = useMutation({
    mutationFn: () => api.zefoSync(cid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["zefo-keywords", cid] });
      qc.invalidateQueries({ queryKey: ["rank-buckets", cid] });
    },
  });

  const linked = !!client?.zefo_site_id;

  return (
    <div>
      <PageHeader
        title="מעקב מיקומים (ZEFO)"
        subtitle={client?.name || ""}
        actions={
          linked && (
            <button className="btn-primary" onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw size={18} className={sync.isPending ? "animate-spin" : ""} /> סנכרן מ-ZEFO
            </button>
          )
        }
      />

      {!linked && (
        <div className="card mb-4 bg-amber-50 border-amber-200 text-amber-800 text-sm">
          הלקוח עדיין לא מקושר לאתר ZEFO. לחץ "ערוך לקוח" בדף הסקירה, ובחר Property מ-ZEFO.
        </div>
      )}

      {sync.isSuccess && (
        <div className="card mb-4 bg-emerald-50 border-emerald-200 text-emerald-800 text-sm">
          סונכרנו {(sync.data as any).synced} מילות מפתח מ-ZEFO.
        </div>
      )}
      {sync.isError && (
        <div className="card mb-4 bg-rose-50 border-rose-200 text-rose-800 text-sm">
          שגיאה: {(sync.error as any)?.message}
        </div>
      )}

      {linked && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="card">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Search size={18} /> חלוקת מיקומים</h3>
            <RankBucketsChart clientId={cid} />
          </div>
          <div className="card">
            <h3 className="font-semibold mb-3">ההזדמנויות שלך</h3>
            <p className="text-slate-500 text-sm mb-3">מילים במיקום 4-15 - עוד דחיפה קטנה ויעלו לעמוד הראשון.</p>
            {keywords && (
              <ul className="space-y-1 text-sm">
                {keywords
                  .filter((k) => k.ranking !== null && k.ranking >= 4 && k.ranking <= 15)
                  .slice(0, 10)
                  .map((k) => (
                    <li key={k.id} className="flex justify-between border-b border-slate-100 py-1 last:border-0">
                      <span className="truncate flex-1">{k.keyword}</span>
                      <span className="font-medium text-amber-700 shrink-0">#{k.ranking}</span>
                    </li>
                  ))}
                {keywords.filter((k) => k.ranking !== null && k.ranking >= 4 && k.ranking <= 15).length === 0 && (
                  <li className="text-slate-400 italic">אין מילים במיקומים 4-15</li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="card mb-4">
        <input
          className="input"
          placeholder="חפש מילת מפתח..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card">
        {isLoading ? <Spinner /> : !keywords || keywords.length === 0 ? (
          <p className="text-center text-slate-500 py-8">אין מילים. {linked && "לחץ \"סנכרן מ-ZEFO\" כדי להתחיל."}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-right text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2">מילה</th>
                <th>מיקום</th>
                <th>שינוי</th>
                <th>שיא</th>
                <th>נפח חיפוש</th>
                <th>עמוד מדורג</th>
              </tr>
            </thead>
            <tbody>
              {keywords.map((k) => (
                <tr key={k.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 font-medium">{k.keyword}</td>
                  <td>
                    <span className={`font-semibold ${
                      k.ranking && k.ranking <= 3 ? "text-emerald-600" :
                      k.ranking && k.ranking <= 10 ? "text-emerald-500" :
                      k.ranking && k.ranking <= 30 ? "text-amber-600" :
                      "text-slate-400"
                    }`}>
                      {k.ranking ? `#${k.ranking}` : "—"}
                    </span>
                  </td>
                  <td><RankDelta current={k.ranking} previous={k.previous_ranking} /></td>
                  <td className="text-emerald-700">{k.best_rank ? `#${k.best_rank}` : "—"}</td>
                  <td>{k.local_searches?.toLocaleString() || "—"}</td>
                  <td className="text-xs">
                    {k.rank_page && (
                      <a href={k.rank_page} target="_blank" rel="noreferrer" className="text-brand-700 truncate inline-flex items-center gap-1 max-w-[280px]">
                        <ExternalLink size={11} />
                        <span className="truncate">{new URL(k.rank_page).pathname || "/"}</span>
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
