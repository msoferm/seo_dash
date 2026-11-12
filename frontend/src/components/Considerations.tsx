import { BarChart3, Brain, Scale, ShieldAlert, CheckCircle2 } from "lucide-react";
import type { StructureConsiderations } from "../api";
import { Md, inline } from "./RichText";

/** The reasoning behind a recommendation/decision, laid out in clear sections. */
export default function Considerations({ c }: { c: StructureConsiderations | null | undefined }) {
  if (!c) return null;
  const has = c.facts?.length || c.intent || c.options?.length || c.risks || c.why;
  if (!has) return null;
  const Section = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => (
    <div>
      <div className="text-xs font-semibold text-slate-600 flex items-center gap-1 mb-0.5">{icon} {title}</div>
      {children}
    </div>
  );
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
      <div className="text-sm font-semibold text-slate-800">שיקולי ההחלטה</div>
      {c.facts?.length > 0 && (
        <Section icon={<BarChart3 size={13} />} title="מה הנתונים מראים">
          <ul className="text-sm space-y-0.5">{c.facts.map((f, i) => <li key={i} className="flex gap-1.5"><span className="text-slate-400">•</span><span>{inline(f)}</span></li>)}</ul>
        </Section>
      )}
      {c.intent && <Section icon={<Brain size={13} />} title="כוונת המשתמש"><Md text={c.intent} /></Section>}
      {c.options?.length > 0 && (
        <Section icon={<Scale size={13} />} title="האפשרויות שנשקלו">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border border-slate-200">
              <thead><tr className="bg-slate-50 text-right"><th className="px-2 py-1 font-medium">אפשרות</th><th className="px-2 py-1 font-medium">יתרונות</th><th className="px-2 py-1 font-medium">חסרונות</th></tr></thead>
              <tbody>
                {c.options.map((o, i) => (
                  <tr key={i} className={`border-t border-slate-100 align-top ${o.chosen ? "bg-emerald-50" : ""}`}>
                    <td className="px-2 py-1 font-medium">{o.chosen && <CheckCircle2 size={12} className="inline text-emerald-600 ml-1" />}{inline(o.option)}{o.chosen && <span className="badge bg-emerald-100 text-emerald-700 mr-1">נבחרה</span>}</td>
                    <td className="px-2 py-1 text-emerald-800">{inline(o.pros)}</td>
                    <td className="px-2 py-1 text-rose-800">{inline(o.cons)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {c.risks && <Section icon={<ShieldAlert size={13} />} title="סיכונים ואיך לצמצם אותם"><Md text={c.risks} /></Section>}
      {c.why && (
        <div className="bg-emerald-50 border border-emerald-200 rounded p-2">
          <div className="text-xs font-semibold text-emerald-800 mb-0.5">למה בחרנו בדרך הזו</div>
          <Md text={c.why} />
        </div>
      )}
    </div>
  );
}
