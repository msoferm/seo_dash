import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, FileText, MousePointerClick, Eye, TrendingUp, RefreshCw, Link2, Pencil, ListChecks, BarChart3, Target } from "lucide-react";
import * as api from "../api";
import KpiCard from "../components/KpiCard";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import EditClientModal from "../components/EditClientModal";
import GscPropertyPicker from "../components/GscPropertyPicker";
import ZefoSitePicker from "../components/ZefoSitePicker";
import Ga4PropertyPicker from "../components/Ga4PropertyPicker";
import OrganicTrafficChart from "../components/OrganicTrafficChart";
import Ga4TrafficChart from "../components/Ga4TrafficChart";
import RankBucketsChart from "../components/RankBucketsChart";

export default function ClientDashboard() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showEdit, setShowEdit] = useState(false);
  const [showGscPicker, setShowGscPicker] = useState(false);
  const [showZefoPicker, setShowZefoPicker] = useState(false);
  const [showGa4Picker, setShowGa4Picker] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", cid],
    queryFn: () => api.getDashboard(cid),
    enabled: !!cid,
  });

  useEffect(() => {
    if (searchParams.get("connected") === "1" && data && !data.client.gsc_property) {
      setShowGscPicker(true);
      const next = new URLSearchParams(searchParams);
      next.delete("connected");
      setSearchParams(next, { replace: true });
    }
  }, [data, searchParams, setSearchParams]);

  const connectGoogle = useMutation({
    mutationFn: () => api.gscAuthorize(cid),
    onSuccess: (d) => { window.location.href = d.auth_url; },
  });

  const syncGsc = useMutation({
    mutationFn: () => api.gscSync(cid, 90),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard", cid] }),
  });

  const syncGa4 = useMutation({
    mutationFn: () => api.ga4Sync(cid, 30),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ga4-daily", cid] });
      qc.invalidateQueries({ queryKey: ["dashboard", cid] });
    },
  });

  const syncZefo = useMutation({
    mutationFn: () => api.zefoSync(cid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["zefo-keywords", cid] });
      qc.invalidateQueries({ queryKey: ["rank-buckets", cid] });
    },
  });

  if (isLoading || !data) return <Spinner />;
  const googleConnected = !!data.client.google_token_json;
  const hasGscProperty = !!data.client.gsc_property;
  const hasGa4 = !!data.client.ga4_property_id;
  const hasZefo = !!data.client.zefo_site_id;

  return (
    <div>
      <PageHeader
        title={data.client.name}
        subtitle={data.client.domain}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setShowEdit(true)}>
              <Pencil size={18} /> ערוך
            </button>
            {!googleConnected && (
              <button className="btn-primary" onClick={() => connectGoogle.mutate()} disabled={connectGoogle.isPending}>
                <Link2 size={18} /> חבר Google
              </button>
            )}
          </>
        }
      />

      {/* Connection bar */}
      <div className="card mb-6">
        <h3 className="font-semibold mb-3 text-sm text-slate-600">חיבורים ונתונים</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* GSC */}
          <div className="flex flex-col gap-2">
            <div className="text-xs text-slate-500">Google Search Console</div>
            {!googleConnected ? (
              <button className="btn-secondary text-sm justify-start" onClick={() => connectGoogle.mutate()}><Link2 size={14} /> חבר Google</button>
            ) : !hasGscProperty ? (
              <button className="btn-primary text-sm justify-start" onClick={() => setShowGscPicker(true)}><ListChecks size={14} /> בחר Property</button>
            ) : (
              <div className="flex gap-1">
                <button className="btn-secondary text-sm" onClick={() => setShowGscPicker(true)}><ListChecks size={14} /></button>
                <button className="btn-primary text-sm flex-1" onClick={() => syncGsc.mutate()} disabled={syncGsc.isPending}>
                  <RefreshCw size={14} className={syncGsc.isPending ? "animate-spin" : ""} /> סנכרן
                </button>
              </div>
            )}
            {hasGscProperty && <div className="text-xs text-slate-400 truncate">{data.client.gsc_property}</div>}
          </div>

          {/* GA4 */}
          <div className="flex flex-col gap-2">
            <div className="text-xs text-slate-500">Google Analytics 4</div>
            {!googleConnected ? (
              <button className="btn-secondary text-sm justify-start opacity-50" disabled><Link2 size={14} /> חבר Google תחילה</button>
            ) : !hasGa4 ? (
              <button className="btn-primary text-sm justify-start" onClick={() => setShowGa4Picker(true)}><ListChecks size={14} /> בחר Property</button>
            ) : (
              <div className="flex gap-1">
                <button className="btn-secondary text-sm" onClick={() => setShowGa4Picker(true)}><ListChecks size={14} /></button>
                <button className="btn-primary text-sm flex-1" onClick={() => syncGa4.mutate()} disabled={syncGa4.isPending}>
                  <RefreshCw size={14} className={syncGa4.isPending ? "animate-spin" : ""} /> סנכרן
                </button>
              </div>
            )}
            {hasGa4 && <div className="text-xs text-slate-400">ID: {data.client.ga4_property_id}</div>}
          </div>

          {/* ZEFO */}
          <div className="flex flex-col gap-2">
            <div className="text-xs text-slate-500">ZEFO Rank Tracker</div>
            {!hasZefo ? (
              <button className="btn-primary text-sm justify-start" onClick={() => setShowZefoPicker(true)}><Target size={14} /> חבר אתר ZEFO</button>
            ) : (
              <div className="flex gap-1">
                <button className="btn-secondary text-sm" onClick={() => setShowZefoPicker(true)}><Target size={14} /></button>
                <button className="btn-primary text-sm flex-1" onClick={() => syncZefo.mutate()} disabled={syncZefo.isPending}>
                  <RefreshCw size={14} className={syncZefo.isPending ? "animate-spin" : ""} /> סנכרן
                </button>
              </div>
            )}
            {hasZefo && <div className="text-xs text-slate-400">Site ID: {data.client.zefo_site_id}</div>}
          </div>
        </div>
        {(syncGsc.isError || syncGa4.isError || syncZefo.isError) && (
          <div className="mt-3 bg-rose-50 border border-rose-200 rounded p-2 text-sm text-rose-700">
            {(syncGsc.error || syncGa4.error || syncZefo.error) as any}
          </div>
        )}
        {syncGsc.isSuccess && <div className="mt-3 text-sm text-emerald-700">GSC: סונכרנו {(syncGsc.data as any).synced} שורות</div>}
        {syncGa4.isSuccess && <div className="mt-3 text-sm text-emerald-700">GA4: סונכרנו {(syncGa4.data as any).synced} שורות</div>}
        {syncZefo.isSuccess && <div className="mt-3 text-sm text-emerald-700">ZEFO: סונכרנו {(syncZefo.data as any).synced} מילים</div>}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard title="קליקים אורגניים (90 ימים)" value={data.stats.gsc_clicks.toLocaleString()} icon={MousePointerClick} color="green" />
        <KpiCard title="חשיפות" value={data.stats.gsc_impressions.toLocaleString()} icon={Eye} color="blue" />
        <KpiCard title="מיקום ממוצע" value={data.stats.avg_position || "—"} icon={TrendingUp} color="amber" />
        <KpiCard title="מילות מפתח במעקב" value={data.stats.keyword_count} icon={Search} color="rose" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><BarChart3 size={18} /> תנועה אורגנית לאורך זמן (GSC)</h3>
          <OrganicTrafficChart clientId={cid} />
        </div>
        <div className="card">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><BarChart3 size={18} /> סשנים אורגניים (GA4)</h3>
          <Ga4TrafficChart clientId={cid} />
        </div>
      </div>

      {hasZefo && (
        <div className="card mb-6">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Target size={18} /> מיקומי גוגל (ZEFO)</h3>
          <RankBucketsChart clientId={cid} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-semibold mb-3">מילות המפתח המובילות (לפי נפח חיפוש)</h3>
          {data.top_keywords.length === 0 ? (
            <p className="text-slate-500 text-sm">עדיין אין מילות מפתח. עבור לעמוד "מילות מפתח".</p>
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

      {showEdit && <EditClientModal client={data.client} onClose={() => setShowEdit(false)} />}
      {showGscPicker && <GscPropertyPicker client={data.client} onClose={() => setShowGscPicker(false)} />}
      {showZefoPicker && <ZefoSitePicker client={data.client} onClose={() => setShowZefoPicker(false)} />}
      {showGa4Picker && <Ga4PropertyPicker client={data.client} onClose={() => setShowGa4Picker(false)} />}
    </div>
  );
}
