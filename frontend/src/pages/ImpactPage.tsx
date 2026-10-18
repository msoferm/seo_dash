import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ExternalLink, TrendingUp, TrendingDown, Minus, RefreshCw, Loader2 } from "lucide-react";
import * as api from "../api";
import type { ImpactRow } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

function Delta({ before, now }: { before: number; now: number }) {
  const d = now - before;
  return (
    <div className="flex items-center justify-center gap-1 tabular-nums">
      <span className="text-slate-400">{before}</span>
      <span className="text-slate-300">→</span>
      <span className="text-slate-900 font-medium">{now}</span>
      {d > 0 ? <span className="text-emerald-600 inline-flex items-center"><TrendingUp size={12} />+{d}</span>
        : d < 0 ? <span className="text-rose-600 inline-flex items-center"><TrendingDown size={12} />{d}</span>
        : <span className="text-slate-300"><Minus size={12} /></span>}
    </div>
  );
}

export default function ImpactPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: rows, isLoading } = useQuery({ queryKey: ["impact", cid], queryFn: () => api.getImpactStats(cid), enabled: !!cid });

  const [syncing, setSyncing] = useState(false);
  const refresh = useMutation({
    mutationFn: async () => { setSyncing(true); await api.gscSync(cid, 90); },
    onSettled: async () => { await qc.invalidateQueries({ queryKey: ["impact", cid] }); setSyncing(false); },
  });

  const list = rows || [];

  return (
    <div>
      <PageHeader
        title="מעקב השפעה"
        subtitle={client ? `${client.name} · מה שבוצע וההשפעה בפועל` : "מעקב השפעה"}
        actions={
          <button className="btn-primary" onClick={() => refresh.mutate()} disabled={syncing}>
            {syncing ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            {syncing ? "מסנכרן נתונים..." : "רענן נתונים"}
          </button>
        }
      />
      {refresh.isError && <div className="mb-3 text-sm text-rose-600">שגיאת סנכרון: {(refresh.error as any)?.message}</div>}

      <div className="card">
        {isLoading ? (
          <Spinner />
        ) : list.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm"><Activity size={36} className="mx-auto mb-2 text-slate-300" />עדיין לא בוצעו המלצות. בצע המלצות ב"מנוע המלצות" והן יופיעו כאן עם ההשפעה.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <th className="text-right p-2 font-medium">מה בוצע</th>
                  <th className="text-right p-2 font-medium">עמוד</th>
                  <th className="p-2 font-medium">קליקים (לפני → עכשיו)</th>
                  <th className="p-2 font-medium">חשיפות (לפני → עכשיו)</th>
                  <th className="p-2 font-medium">תאריך</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r: ImpactRow) => (
                  <tr key={r.rec_id} className="border-b border-slate-100 align-top">
                    <td className="text-right p-2">
                      <div className="font-medium text-slate-900">{r.title}</div>
                      {r.applied_note && <div className="text-xs text-slate-400">{r.applied_note}</div>}
                    </td>
                    <td className="text-right p-2">{r.page ? <a href={r.page} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-1 text-xs break-all"><ExternalLink size={11} className="shrink-0" />{r.page.replace(/^https?:\/\/[^/]+/, "") || r.page}</a> : <span className="text-slate-400 text-xs">—</span>}</td>
                    <td className="p-2"><Delta before={r.clicks_before} now={r.clicks_now} /></td>
                    <td className="p-2"><Delta before={r.impressions_before} now={r.impressions_now} /></td>
                    <td className="text-center p-2 text-xs text-slate-400 whitespace-nowrap">{r.applied_at ? new Date(r.applied_at).toLocaleDateString("he-IL") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-400 mt-3">
          "לפני" = 30 הימים שקדמו לביצוע; "עכשיו" = 30 הימים האחרונים (נמשך חי מ-Google Search Console). מיד אחרי ביצוע שתי התקופות חופפות — ההשפעה מצטברת עם הזמן, כדאי לבדוק שוב אחרי 2-4 שבועות. לחץ "רענן נתונים" לסנכרון עדכני (למשל פעם בחודש).
        </p>
      </div>
    </div>
  );
}
