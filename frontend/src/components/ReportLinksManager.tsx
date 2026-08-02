import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Plus, Trash2, ClipboardPaste, ExternalLink } from "lucide-react";
import * as api from "../api";
import type { ReportLink } from "../api";
import Spinner from "./Spinner";

const COMMON_TYPES = [
  "אינדקס עסקים",
  "אינדקס עסקים באנגלית",
  "פוסט בבלוג",
  "מאמר ממומן",
  "קישור סימניה",
  "קישור חברתי",
  "כרטיס עסק",
  "קישור מצגת מעוצבת",
  "קישור פנימי",
  "החלפת קישורים",
  "פורום",
];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Per-client "bank" of manually-built external links. The team enters what was done;
 * the monthly report pulls from here for the "קישורים שבוצעו" table.
 */
export default function ReportLinksManager({ clientId }: { clientId: number }) {
  const qc = useQueryClient();
  const [linkType, setLinkType] = useState("אינדקס עסקים");
  const [url, setUrl] = useState("");
  const [doneOn, setDoneOn] = useState(todayStr());
  const [notes, setNotes] = useState("");
  const [bulk, setBulk] = useState("");
  const [showBulk, setShowBulk] = useState(false);

  const { data: links, isLoading } = useQuery({
    queryKey: ["report-links", clientId],
    queryFn: () => api.listReportLinks(clientId),
    enabled: !!clientId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["report-links", clientId] });

  const add = useMutation({
    mutationFn: () => api.createReportLink(clientId, { link_type: linkType.trim(), url: url.trim(), notes: notes.trim() || null, done_on: doneOn }),
    onSuccess: () => {
      setUrl("");
      setNotes("");
      invalidate();
    },
  });

  const addBulk = useMutation({
    mutationFn: () => {
      const rows = bulk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          // "type<tab/comma>url"  OR  just a url → default type
          const parts = line.split(/\t|,(?=\s*https?:)/);
          if (parts.length >= 2) {
            const maybeUrl = parts.slice(1).join(",").trim();
            return { link_type: parts[0].trim() || "אחר", url: maybeUrl, done_on: doneOn };
          }
          return { link_type: "אחר", url: line, done_on: doneOn };
        })
        .filter((r) => /^https?:\/\//i.test(r.url));
      return api.bulkCreateReportLinks(clientId, rows);
    },
    onSuccess: () => {
      setBulk("");
      setShowBulk(false);
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteReportLink(id),
    onSuccess: invalidate,
  });

  const canAdd = url.trim().length > 0 && linkType.trim().length > 0 && !add.isPending;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold flex items-center gap-2 text-slate-800">
          <Link2 size={18} /> בנק קישורים ידניים
          <span className="text-slate-400 text-sm font-normal">({(links || []).length})</span>
        </h3>
        <button className="btn-secondary text-sm py-1.5" onClick={() => setShowBulk((s) => !s)}>
          <ClipboardPaste size={16} /> הדבקה מרובה
        </button>
      </div>

      {/* Add one */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 mb-3">
        <input
          className="input md:col-span-3"
          list="link-types"
          placeholder="סוג קישור"
          value={linkType}
          onChange={(e) => setLinkType(e.target.value)}
        />
        <datalist id="link-types">
          {COMMON_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <input
          className="input md:col-span-5"
          placeholder="https://..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && canAdd) add.mutate(); }}
        />
        <input
          type="date"
          className="input md:col-span-2"
          value={doneOn}
          onChange={(e) => setDoneOn(e.target.value)}
        />
        <button className="btn-primary md:col-span-2 justify-center" onClick={() => add.mutate()} disabled={!canAdd}>
          <Plus size={18} /> הוסף
        </button>
      </div>
      <input
        className="input mb-1"
        placeholder="הערה (אופציונלי)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      {add.isError && <div className="text-sm text-rose-600 mt-1">שגיאה: {(add.error as any)?.message}</div>}

      {showBulk && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500 mb-1">שורה לכל קישור. פורמט: <code>סוג קישור[טאב או פסיק]כתובת</code> — או רק כתובת. התאריך יילקח מהשדה למעלה.</p>
          <textarea
            className="input font-mono text-sm"
            rows={5}
            placeholder={"אינדקס עסקים,https://example.com/biz\nפוסט בבלוג\thttps://blog.example.com/post"}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
          />
          <button className="btn-primary mt-2" onClick={() => addBulk.mutate()} disabled={addBulk.isPending || !bulk.trim()}>
            <Plus size={18} /> הוסף הכל
          </button>
          {addBulk.isSuccess && <span className="text-sm text-emerald-600 mr-2">נוספו {addBulk.data} קישורים.</span>}
          {addBulk.isError && <span className="text-sm text-rose-600 mr-2">{(addBulk.error as any)?.message}</span>}
        </div>
      )}

      {/* List */}
      <div className="mt-4">
        {isLoading ? (
          <Spinner />
        ) : (links || []).length === 0 ? (
          <p className="text-slate-500 text-sm py-2">אין עדיין קישורים. הוסף מה שביצעת ללקוח.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(links || []).map((l: ReportLink) => (
              <li key={l.id} className="flex items-center gap-3 py-2">
                <span className="badge bg-brand-50 text-brand-700 shrink-0">{l.link_type}</span>
                <a href={l.url} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline truncate flex items-center gap-1 flex-1 min-w-0">
                  <ExternalLink size={13} className="shrink-0" /> <span className="truncate">{l.url}</span>
                </a>
                <span className="text-xs text-slate-400 shrink-0">{l.done_on}</span>
                <button className="text-slate-400 hover:text-rose-600 shrink-0 p-1" title="מחק" onClick={() => remove.mutate(l.id)}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
