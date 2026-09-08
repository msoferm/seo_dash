import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, FileText, MousePointerClick, Eye, TrendingUp, TrendingDown, Minus, RefreshCw, Link2, Pencil, ListChecks, BarChart3, Target, CheckCircle2, Wand2, ArrowLeft, AlertTriangle } from "lucide-react";
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
import DateRangePicker, { rangeForDays } from "../components/DateRangePicker";

function RankDelta({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null) return <span className="text-slate-400 text-xs">—</span>;
  const delta = previous - current; // higher position number = worse, so positive delta = improvement
  if (delta === 0) return <Minus size={14} className="inline text-slate-400" />;
  if (delta > 0) return <span className="text-emerald-600 text-xs inline-flex items-center"><TrendingUp size={12} /> {delta}</span>;
  return <span className="text-rose-600 text-xs inline-flex items-center"><TrendingDown size={12} /> {Math.abs(delta)}</span>;
}

export default function ClientDashboard() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showEdit, setShowEdit] = useState(false);
  const [showGscPicker, setShowGscPicker] = useState(false);
  const [showZefoPicker, setShowZefoPicker] = useState(false);
  const [showGa4Picker, setShowGa4Picker] = useState(false);

  const [kpiRange, setKpiRange] = useState(() => rangeForDays(90));
  const [gscRange, setGscRange] = useState(() => rangeForDays(90));
  const [ga4Range, setGa4Range] = useState(() => rangeForDays(30));
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", cid],
    queryFn: () => api.getDashboard(cid),
    enabled: !!cid,
  });

  const gscKpis = useQuery({
    queryKey: ["gsc-kpis", cid, kpiRange],
    queryFn: () => api.getGscKpis(cid, kpiRange.from, kpiRange.to),
    enabled: !!cid,
  });

  const convKpi = useQuery({
    queryKey: ["conv-kpi", cid, kpiRange],
    queryFn: () => api.getConversionsSummary(cid, kpiRange.from, kpiRange.to),
    enabled: !!cid,
  });

  // Shares kpiRange so the conversions breakdown always matches the "המרות" KPI above.
  const convSrc = useQuery({
    queryKey: ["conv-src", cid, kpiRange],
    queryFn: () => api.getConversionsSummary(cid, kpiRange.from, kpiRange.to),
    enabled: !!cid,
  });

  const opps = useQuery({
    queryKey: ["opps", cid, kpiRange],
    queryFn: () => api.getGscOpportunities(cid, kpiRange.from, kpiRange.to),
    enabled: !!cid,
  });

  const pmap = useQuery({
    queryKey: ["pmap", cid, kpiRange],
    queryFn: () => api.getPageQueryMap(cid, kpiRange.from, kpiRange.to),
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

  // Auto-sync on load (throttled to once per 6h per client)
  useEffect(() => {
    if (!data || !cid) return;
    const googleConnected = !!data.client.google_token_json;
    const hasGscProperty = !!data.client.gsc_property;
    const hasGa4 = !!data.client.ga4_property_id;
    const hasZefo = !!data.client.zefo_site_id;
    if (!googleConnected && !hasZefo) return;

    const key = `autosync:${cid}`;
    const last = Number(localStorage.getItem(key) || 0);
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    if (Date.now() - last < SIX_HOURS) return;
    localStorage.setItem(key, String(Date.now()));

    const jobs: Promise<unknown>[] = [];
    if (googleConnected && hasGscProperty) jobs.push(api.gscSync(cid, 90).catch(() => {}));
    if (googleConnected && hasGa4) jobs.push(api.ga4Sync(cid, 90).catch(() => {}));
    if (hasZefo) jobs.push(api.zefoSync(cid).catch(() => {}));
    if (jobs.length === 0) return;

    setSyncing(true);
    Promise.all(jobs).finally(() => {
      setSyncing(false);
      for (const k of [
        ["gsc-kpis", cid],
        ["conv-kpi", cid],
        ["conv-src", cid],
        ["ga4-daily", cid],
        ["gsc-daily", cid],
        ["dashboard", cid],
        ["zefo-keywords", cid],
        ["rank-buckets", cid],
      ]) {
        qc.invalidateQueries({ queryKey: k });
      }
    });
  }, [data, cid, qc]);

  const connectGoogle = useMutation({
    mutationFn: () => api.gscAuthorize(cid),
    onSuccess: (d) => { window.location.href = d.auth_url; },
  });

  const syncGsc = useMutation({
    mutationFn: () => api.gscSync(cid, 90),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard", cid] }),
  });

  const syncGa4 = useMutation({
    mutationFn: () => api.ga4Sync(cid, 90),
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
            {!googleConnected ? (
              <button className="btn-primary" onClick={() => connectGoogle.mutate()} disabled={connectGoogle.isPending}>
                <Link2 size={18} /> חבר Google
              </button>
            ) : (
              <button className="btn-secondary" onClick={() => connectGoogle.mutate()} disabled={connectGoogle.isPending} title="חיבור מחדש כש-Google מנותק / ה-token פג">
                <Link2 size={18} /> חבר Google מחדש
              </button>
            )}
          </>
        }
      />

      {/* Connection bar */}
      <div className="card mb-6">
        <h3 className="font-semibold mb-3 text-sm text-slate-700">חיבורים ונתונים</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* GSC */}
          <div className="flex flex-col gap-2">
            <div className="text-xs text-slate-400">Google Search Console</div>
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
            {hasGscProperty && <div className="text-xs text-slate-500 truncate">{data.client.gsc_property}</div>}
          </div>

          {/* GA4 */}
          <div className="flex flex-col gap-2">
            <div className="text-xs text-slate-400">Google Analytics 4</div>
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
            {hasGa4 && <div className="text-xs text-slate-500">ID: {data.client.ga4_property_id}</div>}
          </div>

          {/* ZEFO */}
          <div className="flex flex-col gap-2">
            <div className="text-xs text-slate-400">ZEFO Rank Tracker</div>
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
            {hasZefo && <div className="text-xs text-slate-500">Site ID: {data.client.zefo_site_id}</div>}
          </div>
        </div>
        {(syncGsc.isError || syncGa4.isError || syncZefo.isError) && (
          <div className="mt-3 bg-rose-50 border border-rose-200 rounded p-2 text-sm text-rose-700 whitespace-pre-wrap break-words">
            שגיאת סנכרון: {((syncGsc.error || syncGa4.error || syncZefo.error) as any)?.message ?? "שגיאה לא ידועה"}
          </div>
        )}
        {syncGsc.isSuccess && <div className="mt-3 text-sm text-emerald-700">GSC: סונכרנו {(syncGsc.data as any).synced} שורות</div>}
        {syncGa4.isSuccess && <div className="mt-3 text-sm text-emerald-700">GA4: סונכרנו {(syncGa4.data as any).synced} שורות</div>}
        {syncZefo.isSuccess && <div className="mt-3 text-sm text-emerald-700">ZEFO: סונכרנו {(syncZefo.data as any).synced} מילים</div>}
      </div>

      {/* KPI cards */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm text-slate-700">מדדים מרכזיים</h3>
            {syncing && <span className="text-xs text-slate-400 inline-flex items-center gap-1"><RefreshCw size={12} className="animate-spin" /> מסנכרן נתונים…</span>}
          </div>
          <DateRangePicker value={kpiRange} onChange={setKpiRange} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiCard title="קליקים אורגניים" value={gscKpis.isLoading ? "—" : (gscKpis.data?.clicks ?? 0).toLocaleString()} icon={MousePointerClick} color="green" />
          <KpiCard title="חשיפות" value={gscKpis.isLoading ? "—" : (gscKpis.data?.impressions ?? 0).toLocaleString()} icon={Eye} color="blue" />
          <KpiCard title="מיקום ממוצע" value={gscKpis.isLoading ? "—" : (gscKpis.data?.avg_position || "—")} icon={TrendingUp} color="amber" />
          <KpiCard title="מילות מפתח במעקב" value={data.stats.keyword_count} icon={Search} color="rose" />
          <KpiCard title="המרות" value={convKpi.isLoading ? "—" : (convKpi.data?.total ?? 0).toLocaleString()} icon={CheckCircle2} color="green" />
        </div>
      </div>

      {/* Quick wins — near-first-page opportunities (links to the internal recommendations tab) */}
      {opps.data && opps.data.near_first_page.length > 0 && (
        <div className="card mb-6 border-r-4 border-r-emerald-400">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold flex items-center gap-2 text-slate-800">
              <TrendingUp size={18} className="text-emerald-600" /> הזדמנויות מהירות — קרוב לעמוד הראשון
              <span className="text-xs font-normal text-slate-400">(מיקום 8–20, חשיפות גבוהות)</span>
            </h3>
            <Link to={`/clients/${cid}/recommendations`} className="text-sm text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
              <Wand2 size={15} /> לכל ההמלצות <ArrowLeft size={14} />
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead className="text-right text-slate-500 border-b border-slate-200">
              <tr><th className="py-2">ביטוי</th><th>מיקום</th><th>חשיפות</th><th>קליקים</th></tr>
            </thead>
            <tbody>
              {opps.data.near_first_page.slice(0, 5).map((r) => (
                <tr key={r.term} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 font-medium text-slate-900">{r.term}</td>
                  <td className="font-semibold text-slate-700">{r.position}</td>
                  <td className="text-slate-600">{r.impressions.toLocaleString()}</td>
                  <td className="text-slate-500">{r.clicks.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cannibalization alert (links to internal recommendations) */}
      {pmap.data && pmap.data.cannibalization.length > 0 && (
        <Link to={`/clients/${cid}/recommendations`} className="card mb-6 border-r-4 border-r-rose-400 flex items-center gap-3 hover:bg-rose-50/30 transition-colors">
          <AlertTriangle size={22} className="text-rose-600 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold text-slate-800">זוהתה קניבליזציה ב-{pmap.data.cannibalization.length} ביטויים</div>
            <div className="text-xs text-slate-500">אותו ביטוי מוביל לכמה עמודים — כדאי לאחד ולחדד. לחץ לפירוט ב"המלצות קלוד".</div>
          </div>
          <ArrowLeft size={16} className="text-slate-400 shrink-0" />
        </Link>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h3 className="font-semibold flex items-center gap-2"><BarChart3 size={18} /> תנועה אורגנית לאורך זמן (GSC)</h3>
            <DateRangePicker value={gscRange} onChange={setGscRange} />
          </div>
          <OrganicTrafficChart clientId={cid} from={gscRange.from} to={gscRange.to} />
        </div>
        <div className="card">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h3 className="font-semibold flex items-center gap-2"><BarChart3 size={18} /> סשנים אורגניים (GA4)</h3>
            <DateRangePicker value={ga4Range} onChange={setGa4Range} />
          </div>
          <Ga4TrafficChart clientId={cid} from={ga4Range.from} to={ga4Range.to} />
        </div>
      </div>

      {hasZefo && (
        <div className="card mb-6">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Target size={18} /> מיקומי גוגל (ZEFO)</h3>
          <RankBucketsChart clientId={cid} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Target size={18} /> 10 מילות מפתח מובילות במעקב (ZEFO)</h3>
          {data.top_zefo_keywords.length === 0 ? (
            <p className="text-slate-500 text-sm">אין נתוני ZEFO. חבר אתר ZEFO וסנכרן.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-right text-slate-500 border-b border-slate-200">
                <tr><th className="py-2">מילה</th><th>מיקום</th><th>שינוי</th></tr>
              </thead>
              <tbody>
                {data.top_zefo_keywords.map((k) => (
                  <tr key={k.zefo_keyword_id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 font-medium text-slate-900">{k.keyword}</td>
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
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:text-brand-700 truncate hover:underline">{p.url}</a>
                  <span className="font-medium shrink-0 text-slate-900">{p.clicks.toLocaleString()} קליקים</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h3 className="font-semibold flex items-center gap-2"><CheckCircle2 size={18} /> מקורות התנועה וההמרות</h3>
          <DateRangePicker value={kpiRange} onChange={setKpiRange} />
        </div>
        {convSrc.isLoading ? (
          <Spinner />
        ) : !convSrc.data || convSrc.data.by_source.length === 0 ? (
          <p className="text-slate-500 text-sm">אין נתוני המרות. חבר את Google Analytics 4 וסנכרן.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-right text-slate-500 border-b border-slate-200">
              <tr><th className="py-2">מקור</th><th>המרות</th><th>סשנים</th></tr>
            </thead>
            <tbody>
              {convSrc.data.by_source.map((s, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 font-medium text-slate-900">{s.label}</td>
                  <td className="text-emerald-700">{s.conversions.toLocaleString()}</td>
                  <td className="text-slate-700">{s.sessions.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showEdit && <EditClientModal client={data.client} onClose={() => setShowEdit(false)} />}
      {showGscPicker && <GscPropertyPicker client={data.client} onClose={() => setShowGscPicker(false)} />}
      {showZefoPicker && <ZefoSitePicker client={data.client} onClose={() => setShowZefoPicker(false)} />}
      {showGa4Picker && <Ga4PropertyPicker client={data.client} onClose={() => setShowGa4Picker(false)} />}
    </div>
  );
}
