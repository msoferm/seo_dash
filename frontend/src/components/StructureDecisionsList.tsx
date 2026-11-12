import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Undo2, ExternalLink, CheckCircle2, Brain, Network } from "lucide-react";
import * as api from "../api";
import type { KwPageRow, StructureDecision } from "../api";
import { decisionColor, REC_TYPE_LABEL } from "../lib/decisionColors";
import { Md } from "./StructureChat";

function decodePath(u: string): string {
  try { return decodeURIComponent(u.replace(/^https?:\/\/[^/]+/, "")) || u; } catch { return u; }
}
const norm = (u: string) => (u || "").replace(/\/+$/, "").toLowerCase();

/** Scroll to a page's intent card further down this tab. */
function goToPageCard(url: string) {
  const el = [...document.querySelectorAll<HTMLElement>("[data-focus]")].find((e) => norm(e.dataset.focus || "") === norm(url));
  if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("focus-flash"); setTimeout(() => el.classList.remove("focus-flash"), 2800); }
}

/** Every decision accepted in the structure tab: pages, the keywords competing on them, and the
 *  full explanation + user-intent analysis. Each decision keeps its color; collapsed by default. */
export default function StructureDecisionsList({ cid, rows, titleOf }: { cid: number; rows: KwPageRow[]; titleOf: (url: string) => string | null }) {
  const qc = useQueryClient();
  const { data: decisions } = useQuery({ queryKey: ["structure-decisions", cid], queryFn: () => api.listStructureDecisions(cid), enabled: !!cid });
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [listOpen, setListOpen] = useState(true);
  const undo = useMutation({
    mutationFn: (d: StructureDecision) => api.undoStructureDecision(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["structure-decisions", cid] }); qc.invalidateQueries({ queryKey: ["kw-targets", cid] }); },
  });
  const pagesByKw = useMemo(() => {
    const m = new Map<string, KwPageRow[]>();
    for (const r of rows) { if (!m.has(r.term)) m.set(r.term, []); m.get(r.term)!.push(r); }
    for (const arr of m.values()) arr.sort((a, b) => b.impressions - a.impressions);
    return m;
  }, [rows]);
  const label = (u: string) => titleOf(u) || decodePath(u);

  if (!decisions?.length) return null;
  return (
    <div className="card mb-4 border-r-4 border-r-emerald-400">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button className="font-semibold flex items-center gap-2 text-slate-800" onClick={() => setListOpen((o) => !o)}>
          <CheckCircle2 size={18} className="text-emerald-600" /> החלטות מבנה שאושרו ({decisions.length})
          {listOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        <Link to={`/clients/${cid}/structure`} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1"><Network size={12} /> לניתוח ה-AI בלשונית ביטויי יעד</Link>
      </div>
      {listOpen && (
        <>
          <p className="text-xs text-slate-500 mt-1">
            ההחלטות שאושרו מניתוח ה-AI בלשונית "ביטויי יעד ועמודי יעד". כאן מחליטים, לפי כוונת המשתמש, איזה תוכן לכתוב בכל עמוד. לכל עמוד יעד יש כפתור שמוביל לכרטיס שלו למטה, ושם נמצאים כל כפתורי הניתוח.
          </p>
          <div className="space-y-2 mt-3">
            {decisions.map((d) => {
              const c = decisionColor(d.color);
              const isOpen = !!open[d.id];
              const targetPages = [...new Set(d.actions.map((a) => a.page_url).filter(Boolean) as string[])];
              const otherPages = d.pages.filter((p) => !targetPages.some((t) => norm(t) === norm(p)));
              const newPageKws = d.actions.filter((a) => !a.page_url).map((a) => a.keyword);
              return (
                <div key={d.id} data-focus={`decision-${d.id}`} className="rounded-lg p-3 border" style={{ background: c.bg, borderColor: c.border, borderRightWidth: 5 }}>
                  <div className="flex items-start justify-between gap-2">
                    <button className="flex items-start gap-1.5 text-right min-w-0" onClick={() => setOpen((o) => ({ ...o, [d.id]: !isOpen }))}>
                      {isOpen ? <ChevronUp size={16} className="mt-0.5 shrink-0" style={{ color: c.text }} /> : <ChevronDown size={16} className="mt-0.5 shrink-0" style={{ color: c.text }} />}
                      <span>
                        <span className="font-medium" style={{ color: c.text }}>{d.title}</span>
                        <span className="text-xs text-slate-500 mr-2">{REC_TYPE_LABEL[d.rec_type || ""] || ""} · {d.keywords.length} מילים · {d.accept_mode === "full" ? "התקבלה במלואה" : d.accept_mode === "partial" ? "התקבלה חלקית" : "התקבלה עם הערה"} · {new Date(d.created_at).toLocaleDateString("he-IL")}</span>
                      </span>
                    </button>
                    <button className="text-xs text-slate-500 hover:text-rose-600 inline-flex items-center gap-1 shrink-0" disabled={undo.isPending}
                      onClick={() => { if (confirm(`לבטל את ההחלטה "${d.title}"?\n\nשיוכי עמוד היעד יחזרו למצב שלפני ההחלטה, והמשימה הפתוחה שנוצרה לה תימחק.`)) undo.mutate(d); }}>
                      <Undo2 size={12} /> בטל החלטה
                    </button>
                  </div>

                  {/* Always visible: pages + why */}
                  <div className="text-xs text-slate-700 mt-1.5 space-y-1">
                    {targetPages.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5"><b>עמודי יעד:</b>
                        {targetPages.map((u) => (
                          <span key={u} className="inline-flex items-center gap-1 bg-white/80 border rounded px-1.5 py-0.5" style={{ borderColor: c.border }}>
                            <a href={u} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center gap-0.5"><ExternalLink size={10} /> {label(u)}</a>
                            <button className="text-slate-500 hover:text-brand-700 inline-flex items-center gap-0.5" title="עבור לכרטיס כוונת המשתמש של העמוד" onClick={() => goToPageCard(u)}><Brain size={11} /> לכרטיס</button>
                          </span>
                        ))}
                      </div>
                    )}
                    {newPageKws.length > 0 && <div><b>עמוד חדש{d.new_page_title ? `: ${d.new_page_title}` : ""}</b> ({newPageKws.join(", ")})</div>}
                    {d.explanation && <div className={isOpen ? "" : "line-clamp-2"}><b>למה:</b> {d.explanation}</div>}
                    {d.note && <div><b>הערת צוות:</b> {d.note}</div>}
                  </div>

                  {isOpen && (
                    <div className="mt-3 space-y-3">
                      {d.extra_steps && <div className="text-sm text-slate-700"><b>צעדים נוספים:</b> {d.extra_steps}</div>}
                      {otherPages.length > 0 && (
                        <div className="text-xs text-slate-700 flex flex-wrap gap-1.5 items-center"><b>עמודים נוספים שמעורבים:</b>
                          {otherPages.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center gap-0.5"><ExternalLink size={10} /> {label(u)}</a>)}
                        </div>
                      )}

                      {/* Keywords: decided target + every page of the site competing on it */}
                      {d.keywords.length > 0 && (
                        <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="text-right text-slate-500 border-b border-slate-200">
                              <th className="py-1.5 px-2 font-medium">מילת מפתח</th>
                              <th className="py-1.5 px-2 font-medium">הוחלט: עמוד יעד</th>
                              <th className="py-1.5 px-2 font-medium">עמודים שמתחרים עליה בגוגל (מיקום · חשיפות)</th>
                            </tr></thead>
                            <tbody>
                              {d.keywords.map((k) => {
                                const a = d.actions.find((x) => x.keyword === k);
                                const comp = pagesByKw.get(k) || [];
                                return (
                                  <tr key={k} className="border-b border-slate-100 align-top">
                                    <td className="py-1.5 px-2 font-medium text-slate-800 whitespace-nowrap">{k}{comp.length > 1 && <span className="badge bg-rose-50 text-rose-600 mr-1">{comp.length} עמודים</span>}</td>
                                    <td className="py-1.5 px-2">{a ? (a.page_url ? <a href={a.page_url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{label(a.page_url)}</a> : <span className="text-violet-700">עמוד חדש</span>) : <span className="text-slate-400">ללא שינוי</span>}</td>
                                    <td className="py-1.5 px-2">
                                      {comp.length ? (
                                        <ul className="space-y-0.5">
                                          {comp.map((r) => (
                                            <li key={r.page} className={a?.page_url && norm(a.page_url) === norm(r.page) ? "text-emerald-700 font-medium" : "text-slate-600"}>
                                              <a href={r.page} target="_blank" rel="noreferrer" className="hover:underline">{label(r.page)}</a> · מ' {r.position} · {r.impressions.toLocaleString()}
                                            </li>
                                          ))}
                                        </ul>
                                      ) : <span className="text-slate-400">אין נתוני דירוג בטווח</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {d.intent_analysis && (
                        <div className="bg-white rounded-lg border border-slate-200 p-3">
                          <div className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-1.5"><Brain size={14} className="text-brand-600" /> כוונת המשתמש של הקבוצה</div>
                          <Md text={d.intent_analysis} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
