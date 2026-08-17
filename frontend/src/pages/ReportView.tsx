import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight, Printer, Save, Sparkles, Loader2, MousePointerClick,
  Eye, Target, TrendingUp, ArrowUp, ArrowDown, Minus, Wand2, X, RefreshCw,
} from "lucide-react";
import * as api from "../api";
import Spinner from "../components/Spinner";
import KpiCard from "../components/KpiCard";
import OrganicTrafficChart from "../components/OrganicTrafficChart";
import { reportLabel } from "./ReportsPage";

function num(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("he-IL");
}

/** Ranking delta: lower is better, so improvement = initial - current. */
function RankDelta({ initial, current }: { initial: number | null; current: number | null }) {
  if (initial == null || current == null) return <span className="text-slate-300">—</span>;
  const diff = initial - current;
  if (diff > 0) return <span className="inline-flex items-center gap-0.5 text-emerald-600"><ArrowUp size={13} />{diff}</span>;
  if (diff < 0) return <span className="inline-flex items-center gap-0.5 text-rose-600"><ArrowDown size={13} />{-diff}</span>;
  return <span className="inline-flex items-center gap-0.5 text-slate-400"><Minus size={13} /></span>;
}

export default function ReportView() {
  const { clientId, reportId } = useParams();
  const cid = Number(clientId);
  const rid = Number(reportId);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: report, isLoading: loadingReport } = useQuery({ queryKey: ["report", rid], queryFn: () => api.getReport(rid), enabled: !!rid });
  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });

  const from = report?.period_from;
  const to = report?.period_to;

  const { data: gsc } = useQuery({ queryKey: ["rep-gsc", cid, from, to], queryFn: () => api.getGscKpis(cid, from!, to!), enabled: !!from && !!to });
  const { data: conv } = useQuery({ queryKey: ["rep-conv", cid, from, to], queryFn: () => api.getConversionsSummary(cid, from!, to!), enabled: !!from && !!to });
  const { data: links } = useQuery({ queryKey: ["rep-links", cid, from, to], queryFn: () => api.listReportLinks(cid, from!, to!), enabled: !!from && !!to });
  const { data: zefo } = useQuery({ queryKey: ["rep-zefo", cid], queryFn: () => api.listZefoKeywords(cid), enabled: !!cid });
  const { data: opps } = useQuery({ queryKey: ["rep-opps", cid, from, to], queryFn: () => api.getGscOpportunities(cid, from!, to!), enabled: !!from && !!to });

  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState("");
  const [recs, setRecs] = useState("");
  const [refineOpen, setRefineOpen] = useState(false);
  const [instructions, setInstructions] = useState("");

  useEffect(() => {
    if (report) {
      setSummary(report.summary_text || "");
      setRecs(report.recommendations_text || "");
    }
  }, [report]);

  const save = useMutation({
    mutationFn: () => api.updateReport(rid, { summary_text: summary, recommendations_text: recs }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report", rid] });
      setEditing(false);
    },
  });

  // Refine (with instructions) or rewrite from scratch (instructions omitted).
  // Re-pull fresh GSC + GA4 for the report period, then refresh all metric queries.
  const refresh = useMutation({
    mutationFn: () => api.syncReportPeriod(cid, from!, to!),
    onSuccess: () => {
      for (const k of ["rep-gsc", "rep-conv", "rep-links", "rep-zefo", "gsc-daily"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
    },
  });

  const regen = useMutation({
    mutationFn: (opts?: { instructions?: string }) =>
      api.generateReportNarrative(cid, from!, to!, {
        instructions: opts?.instructions,
        current_summary: summary,
        current_recommendations: recs,
      }),
    onSuccess: (draft) => {
      setSummary(draft.summary);
      setRecs(draft.recommendations);
      setEditing(true);
      setRefineOpen(false);
      setInstructions("");
    },
  });

  if (loadingReport) return <Spinner />;
  if (!report) return <div className="card text-center py-12 text-slate-500">הדוח לא נמצא.</div>;

  // Only real positions (ranking > 0). ranking === -1 means "not ranked" → excluded.
  // Sorted best-to-worst (1, 2, 3 ...).
  const rankedZefo = (zefo || [])
    .filter((z) => z.ranking != null && z.ranking > 0)
    .sort((a, b) => (a.ranking as number) - (b.ranking as number))
    .slice(0, 30);

  return (
    <div>
      {/* Toolbar — hidden in print */}
      <div className="no-print flex flex-wrap items-center gap-2 mb-4">
        <button className="btn-secondary" onClick={() => navigate(`/clients/${cid}/reports`)}>
          <ArrowRight size={18} /> חזרה
        </button>
        <div className="flex-1" />
        <button className="btn-secondary" onClick={() => refresh.mutate()} disabled={refresh.isPending} title="משוך נתונים מעודכנים מ-Google לתקופת הדוח">
          {refresh.isPending ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />} רענן נתונים
        </button>
        <button className="btn-secondary" onClick={() => setRefineOpen(true)} disabled={regen.isPending}>
          {regen.isPending ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />} תקן עם קלוד
        </button>
        {editing ? (
          <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} שמור
          </button>
        ) : (
          <button className="btn-secondary" onClick={() => setEditing(true)}>
            ערוך טקסטים
          </button>
        )}
        <button className="btn-primary" onClick={() => window.print()}>
          <Printer size={18} /> הדפס / PDF
        </button>
      </div>

      {refresh.isSuccess && !refresh.data?.gsc && !refresh.data?.ga4 && (
        <div className="no-print text-sm text-emerald-600 mb-3">✓ הנתונים עודכנו מ-Google לתקופת הדוח.</div>
      )}
      {refresh.isSuccess && (refresh.data?.gsc || refresh.data?.ga4) && (
        <div className="no-print text-sm text-amber-600 mb-3">
          חלק מהנתונים לא סונכרנו: {refresh.data?.gsc} {refresh.data?.ga4} — ודא שהלקוח מחובר ל-Google עם GSC ו-GA4.
        </div>
      )}

      {/* ===== The printable report ===== */}
      <div className="report-sheet bg-white border border-slate-200 rounded-xl shadow-sm p-8 max-w-4xl mx-auto">
        {/* Cover / header */}
        <div className="flex items-center justify-between border-b-2 border-brand-600 pb-4 mb-6">
          <div>
            <div className="text-brand-700 font-bold text-lg">{client?.name || "לקוח"}</div>
            <div className="text-xs text-slate-400">{client?.domain}</div>
          </div>
          <div className="text-left">
            <h1 className="text-2xl font-bold text-slate-900">דוח קידום אורגני</h1>
            <div className="text-slate-500">{reportLabel(report)}</div>
            <div className="text-xs text-slate-400">{report.period_from} – {report.period_to}</div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <KpiCard title="קליקים אורגניים" value={num(gsc?.clicks)} icon={MousePointerClick} color="green" />
          <KpiCard title="חשיפות" value={num(gsc?.impressions)} icon={Eye} color="blue" />
          <KpiCard title="מיקום ממוצע" value={gsc?.avg_position ?? "—"} icon={Target} color="amber" />
          <KpiCard title="המרות אורגניות" value={num(conv?.organic)} hint={`סה"כ כל הערוצים: ${num(conv?.total)}`} icon={TrendingUp} color="rose" />
        </div>

        {/* Activity summary */}
        <section className="mb-6">
          <h2 className="text-lg font-bold text-slate-900 mb-2 border-r-4 border-brand-500 pr-2">סיכום פעילות</h2>
          {editing ? (
            <textarea className="input" rows={7} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="סיכום פעילות החודש..." />
          ) : summary ? (
            <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{summary}</p>
          ) : (
            <p className="text-slate-400 text-sm">אין עדיין טקסט. לחץ "נסח מחדש (קלוד)" או "ערוך טקסטים".</p>
          )}
        </section>

        {/* Organic traffic chart */}
        <section className="mb-6">
          <h2 className="text-lg font-bold text-slate-900 mb-2 border-r-4 border-brand-500 pr-2">תנועה אורגנית (Search Console)</h2>
          {from && to && <OrganicTrafficChart clientId={cid} from={from} to={to} />}
        </section>

        {/* Rankings */}
        <section className="mb-6">
          <h2 className="text-lg font-bold text-slate-900 mb-2 border-r-4 border-brand-500 pr-2">מיקומים אורגניים בגוגל</h2>
          {rankedZefo.length === 0 ? (
            <p className="text-slate-400 text-sm">אין נתוני מיקומים (ZEFO). סנכרן ב"מעקב מיקומים".</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="text-right p-2 font-medium">מילת מפתח</th>
                  <th className="p-2 font-medium">חיפושים</th>
                  <th className="p-2 font-medium">מיקום התחלתי</th>
                  <th className="p-2 font-medium">מיקום נוכחי</th>
                  <th className="p-2 font-medium">שינוי</th>
                </tr>
              </thead>
              <tbody>
                {rankedZefo.map((z) => (
                  <tr key={z.id} className="border-b border-slate-100">
                    <td className="text-right p-2 text-slate-800">{z.keyword}</td>
                    <td className="text-center p-2 text-slate-500">{z.local_searches ?? "—"}</td>
                    <td className="text-center p-2 text-slate-500">{z.initial_ranking ?? "—"}</td>
                    <td className="text-center p-2 font-semibold text-slate-900">{z.ranking ?? "—"}</td>
                    <td className="text-center p-2"><RankDelta initial={z.initial_ranking} current={z.ranking} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Opportunity #1 — near first page */}
        <section className="mb-6">
          <h2 className="text-lg font-bold text-slate-900 mb-1 border-r-4 border-emerald-500 pr-2">הזדמנויות מהירות — ביטויים קרובים לעמוד הראשון</h2>
          <p className="text-xs text-slate-500 mb-2">ביטויים במיקום 8–20 עם חשיפות משמעותיות (30+) — פוטנציאל הצמיחה המהיר ביותר. שיפור תוכן, כותרות, שאלות ותשובות וקישורים פנימיים בעמוד הרלוונטי צפוי להעלות אותם לעמוד הראשון.</p>
          {!opps || opps.near_first_page.length === 0 ? (
            <p className="text-slate-400 text-sm">אין ביטויים מתאימים בתקופה. ודא שיש נתוני GSC (לחץ "רענן נתונים").</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-emerald-50 text-slate-600">
                  <th className="text-right p-2 font-medium">ביטוי</th>
                  <th className="p-2 font-medium">חשיפות</th>
                  <th className="p-2 font-medium">מיקום</th>
                  <th className="p-2 font-medium">קליקים</th>
                  <th className="p-2 font-medium">CTR</th>
                </tr>
              </thead>
              <tbody>
                {opps.near_first_page.map((r) => (
                  <tr key={r.term} className="border-b border-slate-100">
                    <td className="text-right p-2 text-slate-800">{r.term}</td>
                    <td className="text-center p-2 text-slate-600">{num(r.impressions)}</td>
                    <td className="text-center p-2 font-semibold text-slate-900">{r.position}</td>
                    <td className="text-center p-2 text-slate-500">{num(r.clicks)}</td>
                    <td className="text-center p-2 text-slate-500">{(r.ctr * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Opportunity #2 — high impressions, low CTR */}
        <section className="mb-6">
          <h2 className="text-lg font-bold text-slate-900 mb-1 border-r-4 border-amber-500 pr-2">חשיפות גבוהות ו-CTR נמוך</h2>
          <p className="text-xs text-slate-500 mb-2">ביטויים שמופיעים בגוגל אך נלחצים פחות מהצפוי <span className="font-medium">ביחס למיקום</span> (לא סף אחיד) — הזדמנות לשיפור כותרת ה-SEO ותיאור ה-Meta: יתרון, מספר, מיקום או מחיר בכותרת.</p>
          {!opps || opps.low_ctr.length === 0 ? (
            <p className="text-slate-400 text-sm">אין ביטויים מתאימים בתקופה.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-amber-50 text-slate-600">
                  <th className="text-right p-2 font-medium">ביטוי</th>
                  <th className="p-2 font-medium">חשיפות</th>
                  <th className="p-2 font-medium">מיקום</th>
                  <th className="p-2 font-medium">CTR בפועל</th>
                  <th className="p-2 font-medium">CTR צפוי</th>
                </tr>
              </thead>
              <tbody>
                {opps.low_ctr.map((r) => (
                  <tr key={r.term} className="border-b border-slate-100">
                    <td className="text-right p-2 text-slate-800">{r.term}</td>
                    <td className="text-center p-2 text-slate-600">{num(r.impressions)}</td>
                    <td className="text-center p-2 text-slate-700">{r.position}</td>
                    <td className="text-center p-2 font-semibold text-rose-600">{(r.ctr * 100).toFixed(1)}%</td>
                    <td className="text-center p-2 text-slate-400">{(r.expected_ctr * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Links built */}
        <section className="mb-6">
          <h2 className="text-lg font-bold text-slate-900 mb-2 border-r-4 border-brand-500 pr-2">
            קישורים שבוצעו <span className="text-slate-400 text-sm font-normal">({(links || []).length})</span>
          </h2>
          {(links || []).length === 0 ? (
            <p className="text-slate-400 text-sm">לא נרשמו קישורים בתקופה זו. הוסף ב"בנק קישורים" שבעמוד הדוחות.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="text-right p-2 font-medium">סוג הקישור</th>
                  <th className="text-right p-2 font-medium">כתובת</th>
                  <th className="p-2 font-medium">תאריך</th>
                </tr>
              </thead>
              <tbody>
                {(links || []).map((l) => (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="text-right p-2 text-slate-800 whitespace-nowrap">{l.link_type}</td>
                    <td className="text-right p-2"><a href={l.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline break-all">{l.url}</a></td>
                    <td className="text-center p-2 text-slate-400 whitespace-nowrap">{l.done_on}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Conversions breakdown */}
        <section className="mb-6">
          <h2 className="text-lg font-bold text-slate-900 mb-2 border-r-4 border-brand-500 pr-2">המרות לפי ערוץ</h2>
          {(conv?.by_source || []).length === 0 ? (
            <p className="text-slate-400 text-sm">אין נתוני המרות בתקופה. סנכרן GA4.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="text-right p-2 font-medium">ערוץ / מקור</th>
                  <th className="p-2 font-medium">המרות</th>
                  <th className="p-2 font-medium">סשנים</th>
                </tr>
              </thead>
              <tbody>
                {(conv?.by_source || []).map((s) => (
                  <tr key={s.label} className="border-b border-slate-100">
                    <td className="text-right p-2 text-slate-800">{s.label}</td>
                    <td className="text-center p-2 font-semibold text-slate-900">{num(s.conversions)}</td>
                    <td className="text-center p-2 text-slate-500">{num(s.sessions)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="text-right p-2">סה"כ</td>
                  <td className="text-center p-2">{num(conv?.total)}</td>
                  <td className="text-center p-2">{num(conv?.total_sessions)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>

        {/* Recommendations */}
        <section>
          <h2 className="text-lg font-bold text-slate-900 mb-2 border-r-4 border-brand-500 pr-2">המלצות להמשך</h2>
          {editing ? (
            <textarea className="input" rows={7} value={recs} onChange={(e) => setRecs(e.target.value)} placeholder="המלצות להמשך..." />
          ) : recs ? (
            <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{recs}</p>
          ) : (
            <p className="text-slate-400 text-sm">אין עדיין טקסט.</p>
          )}
        </section>
      </div>

      {/* Refine-with-instructions dialog */}
      {refineOpen && (
        <div
          className="no-print fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !regen.isPending && setRefineOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Wand2 size={20} className="text-brand-600" /> תקן את הדוח עם קלוד
              </h3>
              <button className="text-slate-400 hover:text-slate-700 p-1" onClick={() => setRefineOpen(false)} disabled={regen.isPending}>
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-3">
              כתוב מה תרצה שקלוד יתקן או ישנה. הוא ישכתב את הטקסט הקיים לפי ההוראות שלך — תוך שמירה על הנתונים האמיתיים.
            </p>

            <textarea
              className="input"
              rows={5}
              autoFocus
              placeholder={"לדוגמה:\n· קצר את הסיכום לשתי פסקאות\n· אל תזכיר המרות, אין עדיין מספיק נתונים\n· הדגש את השיפור במיקומים של \"סיורים בעוטף עזה\"\n· טון יותר רשמי"}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />

            <div className="flex flex-wrap gap-1.5 mt-2">
              {["קצר יותר", "יותר מפורט", "טון רשמי יותר", "בלי המרות", "הדגש שיפור מיקומים"].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
                  onClick={() => setInstructions((cur) => (cur ? cur + "\n· " + chip : "· " + chip))}
                >
                  + {chip}
                </button>
              ))}
            </div>

            {regen.isError && (
              <div className="mt-3 bg-rose-50 border border-rose-200 rounded-lg p-2 text-sm text-rose-700">
                {(regen.error as any)?.message}
              </div>
            )}

            <div className="flex items-center gap-2 mt-4">
              <button
                className="btn-primary"
                onClick={() => regen.mutate({ instructions })}
                disabled={regen.isPending || !instructions.trim()}
              >
                {regen.isPending ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />} שלח לתיקון
              </button>
              <button
                className="btn-secondary"
                onClick={() => { if (confirm("לכתוב את הטקסט מחדש מאפס (בלי ההוראות)?")) regen.mutate(undefined); }}
                disabled={regen.isPending}
              >
                <Sparkles size={18} /> כתוב מחדש מאפס
              </button>
              <div className="flex-1" />
              <button className="btn-secondary" onClick={() => setRefineOpen(false)} disabled={regen.isPending}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
