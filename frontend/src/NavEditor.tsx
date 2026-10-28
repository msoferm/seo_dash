import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Save, Loader2, ChevronUp, ChevronDown, Plus, Trash2, Heading, RotateCcw, GripVertical, ChevronsDownUp, Globe, User } from "lucide-react";
import * as api from "./api";
import { CLIENT_NAV_BY_KEY, resolveNav } from "./navItems";
import type { NavEntry } from "./navItems";

export default function NavEditor({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [list, setList] = useState<NavEntry[]>([]);
  const [scope, setScope] = useState<"global" | "client">("global");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const { data: globalCfg } = useQuery({ queryKey: ["nav-config-global"], queryFn: () => api.getGlobalNavConfig() });
  const { data: clientOverride } = useQuery({ queryKey: ["nav-config-override", clientId], queryFn: () => api.getClientNavOverride(clientId) });
  const hasOverride = !!(clientOverride && clientOverride.length);

  // Initial scope: if this client already has its own override, open on that; else global.
  useEffect(() => { setScope(hasOverride ? "client" : "global"); }, [hasOverride]);
  // Load the list for the active scope.
  useEffect(() => {
    const base = scope === "client" ? (clientOverride ?? globalCfg) : globalCfg;
    setList(resolveNav(base));
  }, [scope, globalCfg, clientOverride]);

  const invalidateNav = () => {
    qc.invalidateQueries({ queryKey: ["nav-config"] });
    qc.invalidateQueries({ queryKey: ["nav-config-global"] });
    qc.invalidateQueries({ queryKey: ["nav-config-override", clientId] });
  };
  const save = useMutation({
    mutationFn: () => api.saveNavConfig(list, scope === "client" ? clientId : undefined),
    onSuccess: () => { invalidateNav(); onClose(); },
  });
  const reset = useMutation({
    mutationFn: () => scope === "client" ? api.resetClientNavOverride(clientId) : api.saveNavConfig([]),
    onSuccess: () => { invalidateNav(); onClose(); },
  });

  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= list.length) return;
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; setList(next);
  };
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
    const next = [...list]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); setList(next);
  };
  const setLabel = (i: number, label: string) => { const next = [...list]; next[i] = { ...next[i], label } as NavEntry; setList(next); };
  const toggleCollapsible = (i: number) => { const next = [...list]; const h = next[i]; if (h.t === "h") { next[i] = { ...h, collapsible: !h.collapsible }; setList(next); } };
  const removeAt = (i: number) => setList(list.filter((_, idx) => idx !== i));
  const addHeading = () => setList([{ t: "h", id: `h${Date.now()}`, label: "כותרת חדשה" }, ...list]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">עריכת תפריט</h3>
          <button className="text-slate-400 hover:text-slate-700 p-1" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="px-5 pt-3">
          <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              className={`flex-1 flex items-center justify-center gap-1.5 text-sm py-1.5 rounded-md transition-colors ${scope === "global" ? "bg-white shadow-sm text-brand-700 font-medium" : "text-slate-500 hover:text-slate-700"}`}
              onClick={() => setScope("global")}
            ><Globe size={15} /> תפריט גלובלי (כל הלקוחות)</button>
            <button
              className={`flex-1 flex items-center justify-center gap-1.5 text-sm py-1.5 rounded-md transition-colors ${scope === "client" ? "bg-white shadow-sm text-brand-700 font-medium" : "text-slate-500 hover:text-slate-700"}`}
              onClick={() => setScope("client")}
            ><User size={15} /> התאמה ללקוח זה {hasOverride && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}</button>
          </div>
        </div>
        <div className="px-5 py-2 text-xs text-slate-500">
          {scope === "global"
            ? "עריכת התפריט שחל על כל הלקוחות. גרור פריטים עם העכבר (או בחצים) לסידור, הוסף כותרות לקיבוץ, וסמן כותרת כ\"תפריט נפתח\"."
            : `התאמה ללקוח הזה בלבד, על בסיס התפריט הגלובלי. ${hasOverride ? "ללקוח יש כבר התאמה אישית." : "כרגע הלקוח משתמש בתפריט הגלובלי — שמירה כאן תיצור לו התאמה נפרדת."}`}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-2 space-y-1">
          {list.map((e, i) => (
            <div
              key={i}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(ev) => { ev.preventDefault(); if (overIndex !== i) setOverIndex(i); }}
              onDrop={(ev) => { ev.preventDefault(); if (dragIndex !== null) reorder(dragIndex, i); setDragIndex(null); setOverIndex(null); }}
              onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
              className={`flex items-center gap-2 rounded-lg p-1.5 ${e.t === "h" ? "bg-slate-100" : "bg-white border border-slate-100"} ${dragIndex === i ? "opacity-40" : ""} ${overIndex === i && dragIndex !== null && dragIndex !== i ? "ring-2 ring-brand-400" : ""}`}
            >
              <GripVertical size={15} className="text-slate-300 shrink-0 cursor-grab active:cursor-grabbing" />
              <div className="flex flex-col">
                <button className="text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp size={14} /></button>
                <button className="text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={i === list.length - 1} onClick={() => move(i, 1)}><ChevronDown size={14} /></button>
              </div>
              {e.t === "h" ? (
                <>
                  <Heading size={14} className="text-slate-400 shrink-0" />
                  <input className="input py-1 text-sm flex-1 font-semibold" value={e.label} onChange={(ev) => setLabel(i, ev.target.value)} placeholder="כותרת קבוצה" />
                  <button
                    className={`p-1 shrink-0 rounded ${e.collapsible ? "text-brand-600 bg-brand-50" : "text-slate-400 hover:text-slate-700"}`}
                    title={e.collapsible ? "תפריט נפתח (לחץ כדי להפוך לתפריט פתוח קבוע)" : "הפוך לתפריט נפתח (הלשוניות תחתיו ייפתחו/ייסגרו בלחיצה)"}
                    onClick={() => toggleCollapsible(i)}
                  ><ChevronsDownUp size={15} /></button>
                  <button className="text-slate-400 hover:text-rose-600 p-1 shrink-0" title="מחק כותרת" onClick={() => removeAt(i)}><Trash2 size={15} /></button>
                </>
              ) : (() => {
                const def = CLIENT_NAV_BY_KEY[(e as any).key]; if (!def) return null;
                const Icon = def.icon;
                return (
                  <>
                    <Icon size={15} className="text-slate-400 shrink-0" />
                    <input className="input py-1 text-sm flex-1" value={(e as any).label ?? def.label} onChange={(ev) => setLabel(i, ev.target.value)} placeholder={def.label} />
                  </>
                );
              })()}
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-2">
          <button className="btn-secondary text-sm py-1.5" onClick={addHeading}><Plus size={15} /> הוסף כותרת</button>
          {scope === "client" ? (
            <button className="text-sm py-1.5 px-3 rounded-lg text-slate-500 hover:bg-slate-100 inline-flex items-center gap-1" disabled={!hasOverride || reset.isPending}
              onClick={() => { if (confirm("לבטל את ההתאמה האישית של הלקוח ולחזור לתפריט הגלובלי?")) reset.mutate(); }}><RotateCcw size={14} /> חזור לגלובלי</button>
          ) : (
            <button className="text-sm py-1.5 px-3 rounded-lg text-slate-500 hover:bg-slate-100 inline-flex items-center gap-1" disabled={reset.isPending}
              onClick={() => { if (confirm("לאפס את התפריט הגלובלי לברירת המחדל?")) reset.mutate(); }}><RotateCcw size={14} /> אפס לברירת מחדל</button>
          )}
          <div className="flex-1" />
          <button className="btn-secondary text-sm py-1.5" onClick={onClose}>ביטול</button>
          <button className="btn-primary text-sm py-1.5" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {scope === "client" ? "שמור ללקוח" : "שמור גלובלי"}
          </button>
        </div>
      </div>
    </div>
  );
}
