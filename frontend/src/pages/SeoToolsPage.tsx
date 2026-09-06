import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Stethoscope, FileText, Loader2, Copy, Check, Wrench, X } from "lucide-react";
import * as api from "../api";
import type { AuditIssue } from "../api";
import PageHeader from "../components/PageHeader";

const SEV_BADGE: Record<AuditIssue["severity"], string> = {
  high: "bg-rose-50 text-rose-700", medium: "bg-amber-50 text-amber-700", low: "bg-slate-100 text-slate-600",
};
const SEV_LABEL: Record<AuditIssue["severity"], string> = { high: "גבוהה", medium: "בינונית", low: "נמוכה" };
const SEV_ORDER: Record<AuditIssue["severity"], number> = { high: 0, medium: 1, low: 2 };

export default function SeoToolsPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });

  const audit = useMutation({ mutationFn: () => api.runSeoAudit(cid) });

  // Per-issue fix state (issues have no stable id → key by page+issue text)
  const keyOf = (i: AuditIssue) => `${i.page}#${i.issue}`;
  const [fixState, setFixState] = useState<Record<string, { status: "fixing" | "fixed" | "rejected" | "error"; note?: string }>>({});
  function doFix(i: AuditIssue) {
    const k = keyOf(i);
    setFixState((s) => ({ ...s, [k]: { status: "fixing" } }));
    api.applyAuditFix(cid, i)
      .then((r) => setFixState((s) => ({ ...s, [k]: { status: "fixed", note: r.note } })))
      .catch((e) => setFixState((s) => ({ ...s, [k]: { status: "error", note: e?.message } })));
  }
  function doReject(i: AuditIssue) { setFixState((s) => ({ ...s, [keyOf(i)]: { status: "rejected" } })); }

  const [keyword, setKeyword] = useState("");
  const brief = useMutation({ mutationFn: (kw: string) => api.generateContentBrief(cid, kw) });
  const [copied, setCopied] = useState(false);

  function copyBrief() {
    const b = brief.data;
    if (!b) return;
    const text = [
      `בריף תוכן: ${b.keyword}`,
      `כותרת מוצעת: ${b.suggested_title}`,
      `כוונת חיפוש: ${b.search_intent}`,
      `אורך מומלץ: ${b.word_count}`,
      "", "מבנה (Outline):", ...b.outline.map((o) => `• ${o}`),
      "", "שאלות לענות עליהן:", ...b.questions.map((q) => `• ${q}`),
      "", "מונחים לכלול:", b.entities.join(", "),
      "", `קישורים פנימיים: ${b.internal_links}`,
      `הערות: ${b.notes}`,
    ].join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const issues = (audit.data?.issues || []).slice().sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  return (
    <div>
      <PageHeader title="כלי SEO" subtitle={client ? `${client.name} · אודיט טכני ובריפים לתוכן` : "כלי SEO"} />

      {/* Technical audit */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold flex items-center gap-2 text-slate-800"><Stethoscope size={18} className="text-brand-600" /> אודיט טכני לאתר</h3>
          <button className="btn-primary" onClick={() => audit.mutate()} disabled={audit.isPending}>
            {audit.isPending ? <Loader2 size={18} className="animate-spin" /> : <Stethoscope size={18} />}
            {audit.isPending ? "בודק את העמודים..." : "הרץ אודיט"}
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-3">קלוד מושך את העמודים המובילים באתר ובודק כותרות, תיאורי Meta, H1, מבנה, סכמה ובעיות נפוצות.</p>
        {audit.isError ? (
          <div className="text-sm text-rose-600">{(audit.error as any)?.message}</div>
        ) : audit.data ? (
          <>
            {audit.data.summary && <p className="text-slate-700 mb-3">{audit.data.summary}</p>}
            {issues.length === 0 ? (
              <p className="text-slate-400 text-sm">לא נמצאו בעיות מהותיות.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse min-w-[760px]">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600">
                      <th className="p-2 font-medium">חומרה</th>
                      <th className="text-right p-2 font-medium">עמוד</th>
                      <th className="text-right p-2 font-medium">בעיה</th>
                      <th className="text-right p-2 font-medium">תיקון</th>
                      <th className="p-2 font-medium">פעולה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.map((i, idx) => {
                      const st = fixState[keyOf(i)];
                      return (
                        <tr key={idx} className="border-b border-slate-100 align-top">
                          <td className="p-2 text-center"><span className={`badge ${SEV_BADGE[i.severity]}`}>{SEV_LABEL[i.severity]}</span></td>
                          <td className="text-right p-2"><a href={i.page} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline break-all text-xs">{i.page.replace(/^https?:\/\/[^/]+/, "") || i.page}</a></td>
                          <td className="text-right p-2 text-slate-700">{i.issue}</td>
                          <td className="text-right p-2 text-slate-600">{i.fix}</td>
                          <td className="p-2 text-center whitespace-nowrap min-w-[150px]">
                            {!st ? (
                              <div className="flex items-center justify-center gap-1">
                                <button className="btn-primary text-xs py-1 px-2" onClick={() => doFix(i)}><Wrench size={13} /> בצע</button>
                                <button className="text-xs py-1 px-2 rounded text-slate-500 hover:bg-slate-100" onClick={() => doReject(i)}><X size={13} /> דחה</button>
                              </div>
                            ) : st.status === "fixing" ? (
                              <span className="text-xs text-slate-500 inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> מבצע...</span>
                            ) : st.status === "fixed" ? (
                              <span className="text-xs text-emerald-600 inline-flex items-center gap-1" title={st.note}><Check size={13} /> תוקן</span>
                            ) : st.status === "rejected" ? (
                              <span className="text-xs text-slate-400">נדחה</span>
                            ) : (
                              <span className="text-xs text-rose-600 inline-flex items-center gap-1" title={st.note}>שגיאה
                                <button className="underline" onClick={() => doFix(i)}>נסה שוב</button>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-slate-400 mt-2">נבדקו {audit.data.pages_checked} עמודים.</p>
          </>
        ) : (
          <p className="text-slate-400 text-sm">לחץ "הרץ אודיט" כדי לבדוק את האתר.</p>
        )}
      </div>

      {/* Content brief */}
      <div className="card">
        <h3 className="font-semibold flex items-center gap-2 text-slate-800 mb-3"><FileText size={18} className="text-brand-600" /> בריף תוכן למילת מפתח</h3>
        <div className="flex gap-2 mb-3">
          <input className="input flex-1" placeholder="מילת מפתח יעד (לדוגמה: סיורים בעוטף עזה)" value={keyword}
            onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && keyword.trim()) brief.mutate(keyword.trim()); }} />
          <button className="btn-primary shrink-0" onClick={() => brief.mutate(keyword.trim())} disabled={brief.isPending || !keyword.trim()}>
            {brief.isPending ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />} צור בריף
          </button>
        </div>
        {brief.isError ? (
          <div className="text-sm text-rose-600">{(brief.error as any)?.message}</div>
        ) : brief.isPending ? (
          <div className="text-slate-500 text-sm flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> בודק תוצאות חיפוש ומכין בריף...</div>
        ) : brief.data ? (
          <div className="space-y-3 text-sm">
            <div className="flex justify-end"><button className="btn-secondary text-sm py-1.5" onClick={copyBrief}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "הועתק" : "העתק בריף"}</button></div>
            <Field label="כותרת מוצעת" value={brief.data.suggested_title} />
            <Field label="כוונת חיפוש" value={brief.data.search_intent} />
            <Field label="אורך מומלץ" value={brief.data.word_count} />
            <ListField label="מבנה (Outline)" items={brief.data.outline} />
            <ListField label="שאלות לענות עליהן" items={brief.data.questions} />
            <Field label="מונחים לכלול" value={brief.data.entities.join(", ")} />
            <Field label="קישורים פנימיים" value={brief.data.internal_links} />
            {brief.data.notes && <Field label="הערות / פערים" value={brief.data.notes} />}
          </div>
        ) : (
          <p className="text-slate-400 text-sm">הזן מילת מפתח וקבל בריף מבוסס-SERP לכתיבה.</p>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return <div><span className="font-semibold text-slate-800">{label}: </span><span className="text-slate-700 whitespace-pre-wrap">{value}</span></div>;
}
function ListField({ label, items }: { label: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="font-semibold text-slate-800 mb-1">{label}:</div>
      <ul className="list-disc list-inside text-slate-700 space-y-0.5">{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
    </div>
  );
}
