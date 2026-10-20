import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stethoscope, FileText, Loader2, Copy, Check, Wrench, X, Pencil, RotateCcw, ShieldCheck, Target, Plus } from "lucide-react";
import * as api from "../api";
import type { AuditIssueRow, AuditSeverity, EeatResult } from "../api";
import PageHeader from "../components/PageHeader";

const SEV_BADGE: Record<AuditSeverity, string> = {
  high: "bg-rose-50 text-rose-700", medium: "bg-amber-50 text-amber-700", low: "bg-slate-100 text-slate-600",
};
const SEV_LABEL: Record<AuditSeverity, string> = { high: "גבוהה", medium: "בינונית", low: "נמוכה" };
const SEV_ORDER: Record<AuditSeverity, number> = { high: 0, medium: 1, low: 2 };

export default function SeoToolsPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: issues } = useQuery({ queryKey: ["audit-issues", cid], queryFn: () => api.listAuditIssues(cid), enabled: !!cid });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["audit-issues", cid] });
  const audit = useMutation({ mutationFn: () => api.runSeoAudit(cid), onSuccess: invalidate });
  const apply = useMutation({ mutationFn: (v: { id: number; modification?: string }) => api.applyAuditFix(v.id, v.modification), onSuccess: () => { setModifyId(null); invalidate(); } });
  const reject = useMutation({ mutationFn: (id: number) => api.rejectAuditIssue(id), onSuccess: invalidate });
  const reset = useMutation({ mutationFn: (id: number) => api.resetAuditIssue(id), onSuccess: invalidate });

  const [modifyId, setModifyId] = useState<number | null>(null);
  const [modText, setModText] = useState("");

  const [keyword, setKeyword] = useState("");
  const brief = useMutation({ mutationFn: (kw: string) => api.generateContentBrief(cid, kw) });
  const [copied, setCopied] = useState(false);

  // EEAT / relevance analyzer
  const [eeatUrl, setEeatUrl] = useState("");
  const [eeatKw, setEeatKw] = useState("");
  const eeat = useMutation({ mutationFn: () => api.analyzeEeat(cid, eeatUrl.trim(), eeatKw.trim()) });
  const addRecs = useMutation({ mutationFn: (r: EeatResult) => api.addFixesAsRecommendations(cid, r.page_url, r.keyword, r.fixes) });
  const [snipCopied, setSnipCopied] = useState(false);

  function copyBrief() {
    const b = brief.data; if (!b) return;
    const text = [
      `בריף תוכן: ${b.keyword}`, `כותרת מוצעת: ${b.suggested_title}`, `כוונת חיפוש: ${b.search_intent}`, `אורך מומלץ: ${b.word_count}`,
      "", "מבנה (Outline):", ...b.outline.map((o) => `• ${o}`), "", "שאלות לענות עליהן:", ...b.questions.map((q) => `• ${q}`),
      "", "מונחים לכלול:", b.entities.join(", "), "", `קישורים פנימיים: ${b.internal_links}`, `הערות: ${b.notes}`,
    ].join("\n");
    navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  const sorted = (issues || []).slice().sort((a, b) =>
    (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const pendingCount = (issues || []).filter((i) => i.status === "pending").length;

  return (
    <div>
      <PageHeader title="כלי SEO" subtitle={client ? `${client.name} · אודיט טכני ובריפים לתוכן` : "כלי SEO"} />

      {/* Technical audit */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold flex items-center gap-2 text-slate-800">
            <Stethoscope size={18} className="text-brand-600" /> אודיט טכני לאתר
            {(issues || []).length > 0 && <span className="text-xs font-normal text-slate-400">({pendingCount} ממתינים מתוך {(issues || []).length})</span>}
          </h3>
          <button className="btn-primary" onClick={() => { if (!(issues || []).length || confirm("הרצה חדשה תחליף את הבעיות הקיימות. להמשיך?")) audit.mutate(); }} disabled={audit.isPending}>
            {audit.isPending ? <Loader2 size={18} className="animate-spin" /> : <Stethoscope size={18} />}
            {audit.isPending ? "בודק את העמודים..." : (issues || []).length ? "הרץ אודיט מחדש" : "הרץ אודיט"}
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-3">קלוד מושך את העמודים המובילים ובודק כותרות, תיאורי Meta, H1, מבנה, סכמה ובעיות נפוצות. התוצאות נשמרות עד שתסמן כל אחת.</p>
        {audit.isError && <div className="text-sm text-rose-600 mb-2">{(audit.error as any)?.message}</div>}
        {audit.data?.summary && <p className="text-slate-700 mb-3">{audit.data.summary}</p>}

        {(issues || []).length === 0 ? (
          <p className="text-slate-400 text-sm">{audit.isSuccess ? "לא נמצאו בעיות מהותיות." : 'לחץ "הרץ אודיט" כדי לבדוק את האתר.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[820px]">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="p-2 font-medium">חומרה</th>
                  <th className="text-right p-2 font-medium">עמוד</th>
                  <th className="text-right p-2 font-medium">בעיה</th>
                  <th className="text-right p-2 font-medium">תיקון</th>
                  <th className="p-2 font-medium min-w-[240px]">פעולה</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((i: AuditIssueRow) => {
                  const applying = apply.isPending && apply.variables?.id === i.id;
                  return (
                    <tr key={i.id} className={`border-b border-slate-100 align-top ${i.status !== "pending" ? "opacity-60" : ""}`}>
                      <td className="p-2 text-center"><span className={`badge ${SEV_BADGE[i.severity]}`}>{SEV_LABEL[i.severity]}</span></td>
                      <td className="text-right p-2"><a href={i.page} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline break-all text-xs">{i.page.replace(/^https?:\/\/[^/]+/, "") || i.page}</a></td>
                      <td className="text-right p-2 text-slate-700">{i.issue}</td>
                      <td className="text-right p-2 text-slate-600">{i.fix}</td>
                      <td className="p-2">
                        {i.status === "applied" ? (
                          <span className="text-xs text-emerald-600 inline-flex items-center gap-1" title={i.applied_note || ""}><Check size={14} /> תוקן</span>
                        ) : i.status === "rejected" ? (
                          <span className="text-xs text-slate-400 inline-flex items-center gap-2">נדחה
                            <button className="text-brand-600 hover:underline inline-flex items-center gap-0.5" onClick={() => reset.mutate(i.id)}><RotateCcw size={12} /> החזר</button>
                          </span>
                        ) : applying ? (
                          <span className="text-xs text-slate-500 inline-flex items-center gap-1"><Loader2 size={14} className="animate-spin" /> מבצע...</span>
                        ) : modifyId === i.id ? (
                          <div className="flex flex-col gap-1.5 min-w-[220px]">
                            <textarea className="input py-1 text-xs" rows={2} autoFocus placeholder="מה לשנות בתיקון? (למשל: תוסיף גם CTA, שמור על הטון הקיים...)" value={modText} onChange={(e) => setModText(e.target.value)} />
                            <div className="flex gap-1">
                              <button className="btn-primary text-xs py-1 px-2" onClick={() => apply.mutate({ id: i.id, modification: modText })}><Check size={13} /> יישם עם השינוי</button>
                              <button className="text-xs py-1 px-2 rounded text-slate-500 hover:bg-slate-100" onClick={() => setModifyId(null)}>ביטול</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 flex-wrap">
                            <button className="btn-primary text-xs py-1 px-2" onClick={() => apply.mutate({ id: i.id })}><Wrench size={13} /> קבל ויישם</button>
                            <button className="btn-secondary text-xs py-1 px-2" onClick={() => { setModifyId(i.id); setModText(""); }}><Pencil size={13} /> עם שינוי</button>
                            <button className="text-xs py-1 px-2 rounded text-rose-600 hover:bg-rose-50" onClick={() => reject.mutate(i.id)}><X size={13} /> דחה</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {apply.isError && <div className="text-sm text-rose-600 mt-2">שגיאה בביצוע התיקון: {(apply.error as any)?.message}</div>}
        {audit.data && <p className="text-xs text-slate-400 mt-2">נבדקו {audit.data.pages_checked} עמודים.</p>}
      </div>

      {/* EEAT / relevance analyzer */}
      <div className="card mb-6">
        <h3 className="font-semibold flex items-center gap-2 text-slate-800 mb-1"><ShieldCheck size={18} className="text-brand-600" /> ניתוח רלוונטיות ו-EEAT</h3>
        <p className="text-xs text-slate-500 mb-3">בודק: האם העמוד רלוונטי למילת המפתח, האם הוא נותן תשובה ישירה ומוקדמת (מוכנות ל-Featured Snippet), ואותות E-E-A-T (ניסיון, מומחיות, סמכות, אמון).</p>
        <div className="flex flex-wrap gap-2 mb-3">
          <input className="input flex-1 min-w-[240px]" placeholder="כתובת העמוד (https://...)" value={eeatUrl} onChange={(e) => setEeatUrl(e.target.value)} />
          <input className="input w-56" placeholder="מילת מפתח יעד" value={eeatKw} onChange={(e) => setEeatKw(e.target.value)} />
          <button className="btn-primary shrink-0" onClick={() => eeat.mutate()} disabled={eeat.isPending || !eeatUrl.trim() || !eeatKw.trim()}>
            {eeat.isPending ? <Loader2 size={18} className="animate-spin" /> : <Target size={18} />} נתח
          </button>
        </div>
        {eeat.isError && <div className="text-sm text-rose-600">{(eeat.error as any)?.message}</div>}
        {eeat.data && (() => {
          const r = eeat.data;
          const bar = (s: number) => <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden w-24"><div className={`h-full ${s >= 70 ? "bg-emerald-500" : s >= 40 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${Math.max(3, s)}%` }} /></div>;
          const row = (label: string, s: number, note: string) => (
            <div className="flex items-start gap-2 py-1">
              <span className="w-20 text-slate-600 shrink-0">{label}</span>{bar(s)}<span className="text-slate-500 text-xs flex-1">{note}</span>
            </div>
          );
          return (
            <div className="space-y-3 text-sm border-t border-slate-100 pt-3">
              <div className="flex items-center gap-2">
                <span className={`text-2xl font-bold ${r.overall_score >= 70 ? "text-emerald-600" : r.overall_score >= 40 ? "text-amber-600" : "text-rose-600"}`}>{r.overall_score}</span>
                <span className="text-slate-400">/ 100 ציון כולל</span>
              </div>
              <div><span className="font-semibold text-slate-800">רלוונטיות ({r.relevance.score}): </span><span className="text-slate-700">{r.relevance.verdict}</span></div>
              <div className={`rounded-lg p-3 ${r.direct_answer.answers_directly && r.direct_answer.early ? "bg-emerald-50" : "bg-amber-50"}`}>
                <div className="font-semibold text-slate-800">תשובה ישירה: {r.direct_answer.answers_directly ? "כן" : "לא"}{r.direct_answer.early ? " · מוקדם בעמוד" : " · לא מוקדם מספיק"}</div>
                <div className="text-slate-600 text-xs mt-0.5">{r.direct_answer.explanation}</div>
                {r.direct_answer.suggested_snippet && (
                  <div className="mt-2">
                    <div className="text-xs text-slate-500 mb-1">פסקת תשובה מוצעת לראש העמוד:</div>
                    <div className="bg-white rounded p-2 text-slate-700">{r.direct_answer.suggested_snippet}</div>
                    <button className="btn-secondary text-xs py-1 px-2 mt-1" onClick={() => { navigator.clipboard.writeText(r.direct_answer.suggested_snippet); setSnipCopied(true); setTimeout(() => setSnipCopied(false), 1500); }}>{snipCopied ? <Check size={13} /> : <Copy size={13} />} העתק</button>
                  </div>
                )}
              </div>
              <div>
                <div className="font-semibold text-slate-800 mb-1">E-E-A-T</div>
                {row("ניסיון", r.eeat.experience.score, r.eeat.experience.note)}
                {row("מומחיות", r.eeat.expertise.score, r.eeat.expertise.note)}
                {row("סמכות", r.eeat.authoritativeness.score, r.eeat.authoritativeness.note)}
                {row("אמון", r.eeat.trust.score, r.eeat.trust.note)}
              </div>
              {r.fixes?.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-800">תיקונים מומלצים</span>
                    <button className="btn-secondary text-xs py-1 px-2" onClick={() => addRecs.mutate(r)} disabled={addRecs.isPending}>
                      {addRecs.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} הוסף כהמלצות
                    </button>
                  </div>
                  <ul className="list-disc list-inside text-slate-700 space-y-0.5">{r.fixes.map((f, i) => <li key={i}>{f}</li>)}</ul>
                  {addRecs.isSuccess && <div className="text-xs text-emerald-600 mt-1">נוספו {addRecs.data} המלצות — יופיעו במנוע ההמלצות ובלוח המשימות.</div>}
                  {addRecs.isError && <div className="text-xs text-rose-600 mt-1">{(addRecs.error as any)?.message}</div>}
                </div>
              )}
            </div>
          );
        })()}
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
