import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Loader2, ExternalLink, Wrench, Pencil, X, Check, FileText, TrendingUp, EyeOff } from "lucide-react";
import * as api from "../api";
import type { Recommendation, RecType } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

const TYPE_LABEL: Record<RecType, string> = {
  title_meta: "כותרת/תיאור", improve_page: "שיפור עמוד", add_keywords: "מילות מפתח", new_content: "תוכן חדש",
  cannibalization: "קניבליזציה", internal_link: "קישור פנימי", performance_drop: "ירידת ביצועים", technical: "טכני",
};
const TYPE_BADGE: Record<RecType, string> = {
  title_meta: "bg-blue-50 text-blue-700", improve_page: "bg-brand-50 text-brand-700", add_keywords: "bg-purple-50 text-purple-700",
  new_content: "bg-teal-50 text-teal-700", cannibalization: "bg-rose-50 text-rose-700", internal_link: "bg-indigo-50 text-indigo-700",
  performance_drop: "bg-orange-50 text-orange-700", technical: "bg-slate-100 text-slate-600",
};
const POT_BADGE = { high: "bg-emerald-50 text-emerald-700", medium: "bg-amber-50 text-amber-700", low: "bg-slate-100 text-slate-500" };
const POT_LABEL = { high: "פוטנציאל גבוה", medium: "פוטנציאל בינוני", low: "פוטנציאל נמוך" };
const EFFORT_LABEL = { low: "מאמץ נמוך", medium: "מאמץ בינוני", high: "מאמץ גבוה" };

const FILTERS: { key: "all" | "pending" | "applied" | "done" | "ignored"; label: string; active: string }[] = [
  { key: "all", label: "הכל", active: "bg-brand-600 text-white" },
  { key: "pending", label: "ממתין", active: "bg-slate-600 text-white" },
  { key: "applied", label: "בוצע", active: "bg-emerald-600 text-white" },
  { key: "done", label: "טופל", active: "bg-teal-600 text-white" },
  { key: "ignored", label: "התעלמתי", active: "bg-rose-500 text-white" },
];

function RecCard({ r, onExample, onApply, onIgnore, busy }: {
  r: Recommendation;
  onExample: (id: number) => void;
  onApply: (id: number, mod?: string) => void;
  onIgnore: (id: number) => void;
  busy: { example: boolean; apply: boolean };
}) {
  const [modifying, setModifying] = useState(false);
  const [mod, setMod] = useState("");
  const pageLabel = r.page ? (r.page.replace(/^https?:\/\/[^/]+/, "") || r.page) : null;

  return (
    <div className="card">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className={`badge ${TYPE_BADGE[r.type]}`}>{TYPE_LABEL[r.type]}</span>
        <span className={`badge ${POT_BADGE[r.potential]}`}>{POT_LABEL[r.potential]}</span>
        {r.est_visits > 0 && <span className="badge bg-emerald-50 text-emerald-700 inline-flex items-center gap-1"><TrendingUp size={12} /> ~{r.est_visits} כניסות/חודש</span>}
        <span className="badge bg-slate-100 text-slate-500">{EFFORT_LABEL[r.effort]}</span>
        {r.source && <span className="badge bg-slate-100 text-slate-400">{r.source.toUpperCase()}</span>}
      </div>

      <div className="font-semibold text-slate-900">{r.title}</div>
      {pageLabel && <a href={r.page!} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1 break-all"><ExternalLink size={12} /> {pageLabel}</a>}

      {r.opportunity && <p className="text-sm text-slate-600 mt-2"><span className="font-medium">ההזדמנות:</span> {r.opportunity}</p>}
      {r.whats_missing && <p className="text-sm text-slate-600 mt-0.5"><span className="font-medium">מה חסר:</span> {r.whats_missing}</p>}
      {r.action && <p className="text-sm text-slate-700 mt-0.5"><span className="font-medium">פעולה:</span> {r.action}</p>}

      {r.example && (
        <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-700 whitespace-pre-wrap">
          <div className="text-xs font-semibold text-slate-500 mb-1">דוגמה שנוצרה:</div>{r.example}
        </div>
      )}
      {r.applied_note && <div className="mt-2 text-xs text-emerald-700">{r.applied_note}</div>}

      {r.status === "pending" && (
        modifying ? (
          <div className="mt-3 flex flex-col gap-2">
            <textarea className="input text-sm" rows={2} autoFocus placeholder="מה לשנות ביישום? (למשל: תוסיף CTA, שמור על הטון...)" value={mod} onChange={(e) => setMod(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-primary text-sm py-1.5" onClick={() => onApply(r.id, mod)} disabled={busy.apply}>{busy.apply ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} בצע עם השינוי</button>
              <button className="btn-secondary text-sm py-1.5" onClick={() => setModifying(false)}>ביטול</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap mt-3">
            <button className="btn-secondary text-sm py-1.5" onClick={() => onExample(r.id)} disabled={busy.example}>{busy.example ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} צור דוגמה</button>
            <button className="btn-primary text-sm py-1.5" onClick={() => onApply(r.id)} disabled={busy.apply}>{busy.apply ? <Loader2 size={15} className="animate-spin" /> : <Wrench size={15} />} בצע</button>
            <button className="btn-secondary text-sm py-1.5" onClick={() => setModifying(true)}><Pencil size={15} /> עם שינוי</button>
            <button className="text-sm py-1.5 px-3 rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => onIgnore(r.id)}><EyeOff size={15} /> התעלם</button>
          </div>
        )
      )}
    </div>
  );
}

export default function RecEnginePage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const [months, setMonths] = useState<3 | 6 | 12>(3);
  const [filter, setFilter] = useState<"all" | "pending" | "applied" | "done" | "ignored">("pending");
  const [typeFilter, setTypeFilter] = useState<RecType | "all">("all");

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: recs, isLoading } = useQuery({ queryKey: ["recs", cid], queryFn: () => api.listRecommendations(cid), enabled: !!cid });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["recs", cid] });

  const gen = useMutation({ mutationFn: () => api.generateRecommendations(cid, months), onSuccess: invalidate });
  const example = useMutation({ mutationFn: (id: number) => api.generateRecExample(id), onSuccess: invalidate });
  const apply = useMutation({ mutationFn: (v: { id: number; mod?: string }) => api.applyRecommendation(v.id, v.mod), onSuccess: invalidate });
  const ignore = useMutation({ mutationFn: (id: number) => api.setRecommendationStatus(id, "ignored"), onSuccess: invalidate });

  const all = recs || [];
  const counts: Record<string, number> = { all: all.length };
  for (const s of ["pending", "applied", "done", "ignored"]) counts[s] = all.filter((r) => r.status === s).length;
  const byStatus = filter === "all" ? all : all.filter((r) => r.status === filter);
  const visible = typeFilter === "all" ? byStatus : byStatus.filter((r) => r.type === typeFilter);
  const totalEst = all.filter((r) => r.status === "pending").reduce((s, r) => s + (r.est_visits || 0), 0);
  const types = [...new Set(all.map((r) => r.type))];

  return (
    <div>
      <PageHeader
        title="מנוע המלצות"
        subtitle={client ? `${client.name} · כל ההזדמנויות במקום אחד, מדורגות לפי פוטנציאל` : "מנוע המלצות SEO"}
        actions={
          <>
            <select className="input py-1.5 text-sm w-28" value={months} onChange={(e) => setMonths(Number(e.target.value) as any)}>
              <option value={3}>3 חודשים</option>
              <option value={6}>6 חודשים</option>
              <option value={12}>12 חודשים</option>
            </select>
            <button className="btn-primary" onClick={() => gen.mutate()} disabled={gen.isPending}>
              {gen.isPending ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} {gen.isPending ? "מנתח..." : "רענן המלצות"}
            </button>
          </>
        }
      />

      {gen.isError && <div className="mb-4 text-sm text-rose-600">{(gen.error as any)?.message}</div>}
      {apply.isError && <div className="mb-4 text-sm text-rose-600">שגיאה בביצוע: {(apply.error as any)?.message}</div>}

      {isLoading ? (
        <Spinner />
      ) : all.length === 0 ? (
        <div className="card text-center py-12 text-slate-500">
          <Sparkles size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-slate-700 font-medium mb-1">אין עדיין המלצות</p>
          <p className="text-sm">לחץ "רענן המלצות" — המערכת תנתח את נתוני ה-SEO ותבנה רשימת הזדמנויות מדורגת.</p>
        </div>
      ) : (
        <div className="flex gap-6 items-start">
          <div className="w-40 shrink-0 sticky top-6 flex flex-col gap-1">
            <div className="text-xs text-slate-400 uppercase px-3 mb-1">סטטוס</div>
            {FILTERS.map((t) => (
              <button key={t.key} onClick={() => setFilter(t.key)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${filter === t.key ? t.active : "text-slate-600 hover:bg-slate-100"}`}>
                <span>{t.label}</span>
                <span className={`text-xs rounded-full px-1.5 py-0.5 ${filter === t.key ? "bg-white/25" : "bg-slate-100 text-slate-500"}`}>{counts[t.key]}</span>
              </button>
            ))}
            {types.length > 1 && (
              <>
                <div className="text-xs text-slate-400 uppercase px-3 mt-4 mb-1">סוג</div>
                <button onClick={() => setTypeFilter("all")} className={`text-right px-3 py-1.5 rounded-lg text-sm ${typeFilter === "all" ? "bg-slate-200 text-slate-800" : "text-slate-600 hover:bg-slate-100"}`}>הכל</button>
                {types.map((tp) => (
                  <button key={tp} onClick={() => setTypeFilter(tp)} className={`text-right px-3 py-1.5 rounded-lg text-sm ${typeFilter === tp ? "bg-slate-200 text-slate-800" : "text-slate-600 hover:bg-slate-100"}`}>{TYPE_LABEL[tp]}</button>
                ))}
              </>
            )}
            {totalEst > 0 && <div className="mt-4 px-3 text-xs text-slate-500">פוטנציאל כולל (ממתין):<br /><span className="text-emerald-600 font-semibold text-sm">~{totalEst.toLocaleString()} כניסות/חודש</span></div>}
          </div>

          <div className="flex-1 min-w-0 space-y-4">
            {visible.length === 0 ? (
              <div className="card text-center py-10 text-slate-400 text-sm">אין המלצות בסינון הזה.</div>
            ) : (
              visible.map((r) => (
                <RecCard key={r.id} r={r}
                  onExample={(id) => example.mutate(id)}
                  onApply={(id, mod) => apply.mutate({ id, mod })}
                  onIgnore={(id) => ignore.mutate(id)}
                  busy={{ example: example.isPending && example.variables === r.id, apply: apply.isPending && apply.variables?.id === r.id }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
