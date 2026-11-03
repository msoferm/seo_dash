import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Plus, Trash2, ClipboardPaste, ExternalLink, Tag, X, ArrowLeft } from "lucide-react";
import * as api from "../api";
import type { ReportLink } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * #2: a GLOBAL version of the per-client "manual links bank". Lets the team add built links
 * to ANY client from one central screen. Every link written here lands directly in that
 * client's report → "בנק קישורים ידני" (same report_links table), so nothing else changes.
 */
export default function GlobalLinksPage() {
  const qc = useQueryClient();
  const { data: clients, isLoading: loadingClients } = useQuery({ queryKey: ["clients"], queryFn: () => api.listClients() });

  const [clientId, setClientId] = useState<number | null>(null);
  const cid = clientId ?? (clients && clients[0]?.id) ?? null;

  const [linkType, setLinkType] = useState("");
  const [url, setUrl] = useState("");
  const [doneOn, setDoneOn] = useState(todayStr());
  const [notes, setNotes] = useState("");
  const [bulk, setBulk] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [showTypes, setShowTypes] = useState(false);
  const [newType, setNewType] = useState("");

  const { data: presets } = useQuery({ queryKey: ["link-presets"], queryFn: () => api.listLinkTypePresets() });
  const typeOptions = [...new Set((presets || []).map((p) => p.name))];
  const addType = useMutation({ mutationFn: () => api.addLinkTypePreset(newType.trim()), onSuccess: () => { setNewType(""); qc.invalidateQueries({ queryKey: ["link-presets"] }); } });
  const delType = useMutation({ mutationFn: (id: number) => api.deleteLinkTypePreset(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["link-presets"] }) });

  const { data: links, isLoading: loadingLinks } = useQuery({
    queryKey: ["report-links", cid],
    queryFn: () => api.listReportLinks(cid!),
    enabled: !!cid,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["report-links", cid] });

  const add = useMutation({
    mutationFn: () => api.createReportLink(cid!, { link_type: linkType.trim(), url: url.trim(), notes: notes.trim() || null, done_on: doneOn }),
    onSuccess: () => { setUrl(""); setNotes(""); invalidate(); },
  });
  const addBulk = useMutation({
    mutationFn: () => {
      const rows = bulk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
        const parts = line.split(/\t|,(?=\s*https?:)/);
        if (parts.length >= 2) return { link_type: parts[0].trim() || "אחר", url: parts.slice(1).join(",").trim(), done_on: doneOn };
        return { link_type: linkType.trim() || "אחר", url: line, done_on: doneOn };
      }).filter((r) => /^https?:\/\//i.test(r.url));
      return api.bulkCreateReportLinks(cid!, rows);
    },
    onSuccess: () => { setBulk(""); setShowBulk(false); invalidate(); },
  });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteReportLink(id), onSuccess: invalidate });

  const canAdd = !!cid && url.trim().length > 0 && linkType.trim().length > 0 && !add.isPending;
  const clientName = (clients || []).find((c) => c.id === cid)?.name || "";

  return (
    <div>
      <PageHeader title="קישורים גלובאלי" subtitle="הוספת קישורים ידניים לכל לקוח — ממקום אחד מרוכז" />

      {loadingClients ? (
        <Spinner />
      ) : (clients || []).length === 0 ? (
        <div className="card text-slate-500 text-sm">אין עדיין לקוחות במערכת.</div>
      ) : (
        <>
          <div className="card mb-4">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="font-semibold flex items-center gap-2 text-slate-800"><Globe size={18} className="text-brand-600" /> הוספת קישור</h3>
              <div className="flex gap-1.5">
                <button className="btn-secondary text-sm py-1.5" onClick={() => setShowTypes((s) => !s)}><Tag size={16} /> נהל סוגי קישור</button>
                <button className="btn-secondary text-sm py-1.5" onClick={() => setShowBulk((s) => !s)}><ClipboardPaste size={16} /> הדבקה מרובה</button>
              </div>
            </div>

            {showTypes && (
              <div className="mb-4 bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-2">סוגי קישור קבועים (משותפים לכל הלקוחות) — יופיעו לבחירה בשדה "סוג קישור".</p>
                <div className="flex gap-2 mb-2">
                  <input className="input flex-1" placeholder="שם סוג חדש (למשל: מצגת, תגובה בפורום)" value={newType}
                    onChange={(e) => setNewType(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newType.trim()) addType.mutate(); }} />
                  <button className="btn-primary shrink-0" onClick={() => addType.mutate()} disabled={addType.isPending || !newType.trim()}><Plus size={16} /> הוסף</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(presets || []).map((p) => (
                    <span key={p.id} className="badge bg-white border border-slate-200 text-slate-600 gap-1">{p.name}
                      <button className="text-slate-400 hover:text-rose-600" onClick={() => delType.mutate(p.id)}><X size={11} /></button>
                    </span>
                  ))}
                  {(presets || []).length === 0 && <span className="text-xs text-slate-400">אין עדיין סוגי קישור.</span>}
                </div>
              </div>
            )}

            {/* Fields: client selector + all existing fields */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 mb-3">
              <div className="md:col-span-3">
                <label className="block text-xs text-slate-500 mb-1">לקוח</label>
                <select className="input w-full" value={cid ?? ""} onChange={(e) => setClientId(Number(e.target.value))}>
                  {(clients || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="md:col-span-3">
                <label className="block text-xs text-slate-500 mb-1">סוג קישור</label>
                <input className="input w-full" placeholder="סוג קישור" list="global-link-types" value={linkType} onChange={(e) => setLinkType(e.target.value)} />
                <datalist id="global-link-types">{typeOptions.map((o) => <option key={o} value={o} />)}</datalist>
              </div>
              <div className="md:col-span-4">
                <label className="block text-xs text-slate-500 mb-1">כתובת</label>
                <input className="input w-full" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && canAdd) add.mutate(); }} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-500 mb-1">בוצע בתאריך</label>
                <input type="date" className="input w-full" value={doneOn} onChange={(e) => setDoneOn(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <input className="input flex-1 min-w-[200px]" placeholder="הערה (אופציונלי)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <button className="btn-primary" onClick={() => add.mutate()} disabled={!canAdd}><Plus size={18} /> הוסף ללקוח</button>
            </div>
            {add.isError && <div className="text-sm text-rose-600 mt-1">שגיאה: {(add.error as any)?.message}</div>}
            {add.isSuccess && <div className="text-sm text-emerald-600 mt-1">נוסף ל{clientName} ✓ — מופיע כעת בדוחות הלקוח → בנק קישורים ידני.</div>}

            {showBulk && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-500 mb-1">שורה לכל קישור. פורמט: <code>סוג קישור[טאב או פסיק]כתובת</code> — או רק כתובת (ואז ייעשה שימוש בסוג שנבחר למעלה). הכל ייכנס ללקוח שנבחר.</p>
                <textarea className="input font-mono text-sm" rows={5} placeholder={"אינדקס עסקים,https://example.com/biz\nפוסט בבלוג\thttps://blog.example.com/post"} value={bulk} onChange={(e) => setBulk(e.target.value)} />
                <button className="btn-primary mt-2" onClick={() => addBulk.mutate()} disabled={addBulk.isPending || !bulk.trim() || !cid}><Plus size={18} /> הוסף הכל ל{clientName}</button>
                {addBulk.isSuccess && <span className="text-sm text-emerald-600 mr-2">נוספו {addBulk.data} קישורים.</span>}
                {addBulk.isError && <span className="text-sm text-rose-600 mr-2">{(addBulk.error as any)?.message}</span>}
              </div>
            )}
          </div>

          {/* The selected client's links, so you see what landed */}
          <div className="card">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h3 className="font-semibold flex items-center gap-2 text-slate-800">קישורים של {clientName} <span className="text-slate-400 text-sm font-normal">({(links || []).length})</span></h3>
              {cid && <Link to={`/clients/${cid}/reports`} className="text-sm text-brand-600 hover:underline inline-flex items-center gap-1">לדוחות הלקוח <ArrowLeft size={14} /></Link>}
            </div>
            {loadingLinks ? (
              <Spinner />
            ) : (links || []).length === 0 ? (
              <p className="text-slate-500 text-sm py-2">אין עדיין קישורים ללקוח זה.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {(links || []).map((l: ReportLink) => (
                  <li key={l.id} className="flex items-center gap-3 py-2">
                    <span className="badge bg-brand-50 text-brand-700 shrink-0">{l.link_type}</span>
                    <a href={l.url} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline truncate flex items-center gap-1 flex-1 min-w-0">
                      <ExternalLink size={13} className="shrink-0" /> <span className="truncate">{l.url}</span>
                    </a>
                    <span className="text-xs text-slate-400 shrink-0">{l.done_on}</span>
                    <button className="text-slate-400 hover:text-rose-600 shrink-0 p-1" title="מחק" onClick={() => remove.mutate(l.id)}><Trash2 size={15} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
