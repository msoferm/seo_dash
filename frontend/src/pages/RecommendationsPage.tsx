import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Wand2, Loader2, RefreshCw, TrendingUp, MousePointerClick, Copy, Check, Layers, AlertTriangle } from "lucide-react";
import * as api from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import DateRangePicker, { rangeForDays } from "../components/DateRangePicker";

function num(n: number): string {
  return (n ?? 0).toLocaleString("he-IL");
}

/**
 * Team-facing SEO opportunities + Claude action recommendations.
 * This is our internal working doc — it is deliberately NOT part of the client report.
 */
export default function RecommendationsPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const [range, setRange] = useState(() => rangeForDays(90)); // spec: last 3 months
  const [copied, setCopied] = useState(false);

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const opps = useQuery({
    queryKey: ["opps", cid, range],
    queryFn: () => api.getGscOpportunities(cid, range.from, range.to),
    enabled: !!cid,
  });

  const pmap = useQuery({
    queryKey: ["pmap", cid, range],
    queryFn: () => api.getPageQueryMap(cid, range.from, range.to),
    enabled: !!cid,
  });

  const refresh = useMutation({
    mutationFn: () => api.syncReportPeriod(cid, range.from, range.to),
    onSuccess: () => { opps.refetch(); pmap.refetch(); },
  });

  const generate = useMutation({
    mutationFn: () => api.generateSeoRecommendations(cid, range.from, range.to),
  });

  function copyRecs() {
    if (generate.data?.recommendations) {
      navigator.clipboard.writeText(generate.data.recommendations);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div>
      <PageHeader
        title="המלצות קלוד"
        subtitle={client ? `${client.name} · ניתוח הזדמנויות ופעולות לצוות (פנימי)` : "ניתוח הזדמנויות ופעולות לצוות"}
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <button className="btn-secondary" onClick={() => refresh.mutate()} disabled={refresh.isPending} title="משוך נתוני GSC מעודכנים לתקופה">
              {refresh.isPending ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />} רענן נתונים
            </button>
            <button className="btn-primary" onClick={() => generate.mutate()} disabled={generate.isPending}>
              {generate.isPending ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />} קבל המלצות מקלוד
            </button>
          </>
        }
      />

      {refresh.isSuccess && (refresh.data?.gsc || refresh.data?.ga4) && (
        <div className="mb-4 text-sm text-amber-600">חלק מהנתונים לא סונכרנו: {refresh.data?.gsc} {refresh.data?.ga4}</div>
      )}

      {/* Claude recommendations */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2 text-slate-800"><Wand2 size={18} className="text-brand-600" /> המלצות לפעולה (קלוד)</h3>
          {generate.data?.recommendations && (
            <button className="btn-secondary text-sm py-1.5" onClick={copyRecs}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "הועתק" : "העתק"}
            </button>
          )}
        </div>
        {generate.isPending ? (
          <div className="text-slate-500 text-sm flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> קלוד מנתח את ההזדמנויות...</div>
        ) : generate.isError ? (
          <div className="text-sm text-rose-600">שגיאה: {(generate.error as any)?.message}</div>
        ) : generate.data?.recommendations ? (
          <p className="whitespace-pre-wrap text-slate-700 leading-relaxed">{generate.data.recommendations}</p>
        ) : (
          <p className="text-slate-400 text-sm">לחץ "קבל המלצות מקלוד" כדי לקבל רשימת פעולות מתועדפת מבוססת הנתונים למטה.</p>
        )}
      </div>

      {/* Opportunity tables */}
      {opps.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          {/* Near first page */}
          <div className="card">
            <h3 className="font-semibold flex items-center gap-2 text-slate-800 mb-1">
              <TrendingUp size={18} className="text-emerald-600" /> ביטויים קרובים לעמוד הראשון
            </h3>
            <p className="text-xs text-slate-500 mb-3">מיקום 8–20 עם 30+ חשיפות — פוטנציאל הצמיחה המהיר ביותר. שפרו תוכן, כותרות, שאלות ותשובות וקישורים פנימיים בעמוד.</p>
            {!opps.data || opps.data.near_first_page.length === 0 ? (
              <p className="text-slate-400 text-sm">אין ביטויים מתאימים. לחץ "רענן נתונים" כדי למשוך GSC לתקופה.</p>
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
                  {opps.data.near_first_page.map((r) => (
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
          </div>

          {/* Low CTR */}
          <div className="card">
            <h3 className="font-semibold flex items-center gap-2 text-slate-800 mb-1">
              <MousePointerClick size={18} className="text-amber-600" /> חשיפות גבוהות ו-CTR נמוך
            </h3>
            <p className="text-xs text-slate-500 mb-3">CTR נמוך <span className="font-medium">ביחס למיקום</span> (לא סף אחיד) — הזדמנות לשיפור כותרת ה-SEO ותיאור ה-Meta (יתרון/מספר/מיקום/מחיר).</p>
            {!opps.data || opps.data.low_ctr.length === 0 ? (
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
                  {opps.data.low_ctr.map((r) => (
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
          </div>

          {/* Cannibalization alerts */}
          {pmap.data && pmap.data.cannibalization.length > 0 && (
            <div className="card border-r-4 border-r-rose-400">
              <h3 className="font-semibold flex items-center gap-2 text-slate-800 mb-1">
                <AlertTriangle size={18} className="text-rose-600" /> קניבליזציה — ביטוי אחד מוביל לכמה עמודים
              </h3>
              <p className="text-xs text-slate-500 mb-3">כדאי לאחד/להבהיר איזה עמוד ראשי לכל ביטוי, ולחזק קישורים פנימיים אליו — כדי לא לפצל את הכוח בין עמודים.</p>
              <ul className="space-y-2">
                {pmap.data.cannibalization.map((c) => (
                  <li key={c.term} className="text-sm">
                    <span className="font-semibold text-slate-900">{c.term}</span>
                    <span className="text-slate-400"> ({c.pages.length} עמודים)</span>
                    <ul className="mr-4 mt-0.5 text-xs text-slate-500 list-disc list-inside">
                      {c.pages.slice(0, 4).map((p) => (
                        <li key={p.page}><a href={p.page} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline break-all">{p.page}</a> · מיקום {p.position} · {num(p.impressions)} חשיפות</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Query map per page */}
          <div className="card">
            <h3 className="font-semibold flex items-center gap-2 text-slate-800 mb-1">
              <Layers size={18} className="text-brand-600" /> מפת שאילתות לכל עמוד
            </h3>
            <p className="text-xs text-slate-500 mb-3">מה גוגל חושב שכל עמוד עוסק בו — ביטוי מרכזי ומשניים, ומה הפעולה המומלצת. לחידוד תוכן ומניעת חפיפה.</p>
            {!pmap.data || pmap.data.pages.length === 0 ? (
              <p className="text-slate-400 text-sm">אין נתונים. לחץ "רענן נתונים" כדי למשוך GSC לתקופה.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse min-w-[720px]">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600">
                      <th className="text-right p-2 font-medium">עמוד</th>
                      <th className="text-right p-2 font-medium">ביטוי מרכזי</th>
                      <th className="text-right p-2 font-medium">ביטויים משניים</th>
                      <th className="p-2 font-medium">קליקים</th>
                      <th className="p-2 font-medium">חשיפות</th>
                      <th className="p-2 font-medium">מיקום</th>
                      <th className="p-2 font-medium">CTR</th>
                      <th className="text-right p-2 font-medium">פעולה מומלצת</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pmap.data.pages.map((p) => (
                      <tr key={p.page} className={`border-b border-slate-100 ${p.cannibalized ? "bg-rose-50/40" : ""}`}>
                        <td className="text-right p-2"><a href={p.page} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline break-all">{p.page.replace(/^https?:\/\/[^/]+/, "") || p.page}</a></td>
                        <td className="text-right p-2 font-medium text-slate-900">{p.primary}</td>
                        <td className="text-right p-2 text-slate-500 text-xs">{p.secondary.join(", ") || "—"}</td>
                        <td className="text-center p-2 text-slate-600">{num(p.clicks)}</td>
                        <td className="text-center p-2 text-slate-600">{num(p.impressions)}</td>
                        <td className="text-center p-2 font-semibold text-slate-800">{p.position}</td>
                        <td className="text-center p-2 text-slate-500">{(p.ctr * 100).toFixed(1)}%</td>
                        <td className="text-right p-2 text-xs text-slate-600">{p.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
