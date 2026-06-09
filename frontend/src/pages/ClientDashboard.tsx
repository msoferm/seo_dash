import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, FileText, MousePointerClick, Eye, TrendingUp, RefreshCw, Link2 } from "lucide-react";
import * as api from "../api";
import KpiCard from "../components/KpiCard";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

export default function ClientDashboard() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", cid],
    queryFn: () => api.getDashboard(cid),
    enabled: !!cid,
  });

  const connectGoogle = useMutation({
    mutationFn: () => api.gscAuthorize(cid),
    onSuccess: (d) => { window.location.href = d.auth_url; },
  });

  const syncGsc = useMutation({
    mutationFn: () => api.gscSync(cid, 90),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard", cid] }),
  });

  if (isLoading || !data) return <Spinner />;
  const googleConnected = !!data.client.google_token_json;

  return (
    <div>
      <PageHeader
        title={data.client.name}
        subtitle={data.client.domain}
        actions={
          <>
            {!googleConnected ? (
              <button className="btn-primary" onClick={() => connectGoogle.mutate()} disabled={connectGoogle.isPending}>
                <Link2 size={18} /> חבר Google
              </button>
            ) : (
              <button className="btn-secondary" onClick={() => syncGsc.mutate()} disabled={syncGsc.isPending}>
                <RefreshCw size={18} className={syncGsc.isPending ? "animate-spin" : ""} /> סנכרן GSC
              </button>
            )}
          </>
        }
      />

      {connectGoogle.isError && (
        <div className="card mb-4 bg-amber-50 border-amber-200 text-amber-800 text-sm">
          {(connectGoogle.error as any)?.message || "שגיאת חיבור — ודא ש-GOOGLE_CLIENT_ID/SECRET מוגדרים ב-Supabase secrets"}
        </div>
      )}
      {syncGsc.isError && (
        <div className="card mb-4 bg-rose-50 border-rose-200 text-rose-800 text-sm">
          שגיאה: {(syncGsc.error as any)?.message}
        </div>
      )}
      {syncGsc.isSuccess && (
        <div className="card mb-4 bg-emerald-50 border-emerald-200 text-emerald-800 text-sm">
          סונכרנו {(syncGsc.data as any).synced} שורות מ-GSC.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard title="קליקים אורגניים" value={data.stats.gsc_clicks.toLocaleString()} icon={MousePointerClick} color="green" />
        <KpiCard title="חשיפות" value={data.stats.gsc_impressions.toLocaleString()} icon={Eye} color="blue" />
        <KpiCard title="מיקום ממוצע" value={data.stats.avg_position || "—"} icon={TrendingUp} color="amber" />
        <KpiCard title="מילות מפתח במעקב" value={data.stats.keyword_count} icon={Search} color="rose" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard title="עמודי האתר במאגר" value={data.stats.page_count} icon={FileText} />
        <KpiCard title="עמודים עם FAQ" value={data.stats.pages_with_faq} icon={FileText} color="green" />
        <KpiCard title="חיבור Google" value={googleConnected ? "מחובר" : "לא מחובר"} color={googleConnected ? "green" : "amber"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-semibold mb-3">מילות המפתח המובילות (לפי נפח חיפוש)</h3>
          {data.top_keywords.length === 0 ? (
            <p className="text-slate-500 text-sm">עדיין אין מילות מפתח. עבור לעמוד "מילות מפתח" והעלה קובץ CSV.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-right text-slate-500 border-b border-slate-200">
                <tr><th className="py-2">מילה</th><th>נפח חודשי</th><th>תחרות</th></tr>
              </thead>
              <tbody>
                {data.top_keywords.map((k) => (
                  <tr key={k.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 font-medium">{k.term}</td>
                    <td>{k.monthly_searches.toLocaleString()}</td>
                    <td><span className="text-slate-500">{k.competition || "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3 className="font-semibold mb-3">העמודים שמושכים הכי הרבה קליקים אורגניים</h3>
          {data.top_pages.length === 0 ? (
            <p className="text-slate-500 text-sm">אין נתוני GSC. חבר את Google Search Console וסנכרן.</p>
          ) : (
            <ul className="space-y-2">
              {data.top_pages.map((p, i) => (
                <li key={i} className="flex justify-between gap-3 text-sm border-b border-slate-100 pb-2 last:border-0">
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-brand-700 truncate hover:underline">{p.url}</a>
                  <span className="font-medium shrink-0">{p.clicks.toLocaleString()} קליקים</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
