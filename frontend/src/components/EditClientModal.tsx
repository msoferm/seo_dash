import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import * as api from "../api";
import { Client } from "../api";

interface Props {
  client: Client;
  onClose: () => void;
}

export default function EditClientModal({ client, onClose }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(client.name);
  const [domain, setDomain] = useState(client.domain);
  const [gscProperty, setGscProperty] = useState(client.gsc_property || "");
  const [ga4Id, setGa4Id] = useState(client.ga4_property_id || "");
  const [notes, setNotes] = useState(client.notes || "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = useMutation({
    mutationFn: () => api.updateClient(client.id, {
      name, domain,
      gsc_property: gscProperty || null,
      ga4_property_id: ga4Id || null,
      notes: notes || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard", client.id] });
      qc.invalidateQueries({ queryKey: ["client", client.id] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      onClose();
    },
  });

  const del = useMutation({
    mutationFn: () => api.deleteClient(client.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      navigate("/");
    },
  });

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="font-semibold text-lg">עריכת לקוח</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
        </div>
        <form
          className="p-5 space-y-3"
          onSubmit={(e) => { e.preventDefault(); update.mutate(); }}
        >
          <div>
            <label className="text-sm text-slate-600">שם הלקוח</label>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-slate-600">דומיין</label>
            <input className="input" required value={domain} onChange={(e) => setDomain(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-slate-600">GSC Property</label>
            <input className="input" placeholder="https://example.com/ או sc-domain:example.com" value={gscProperty} onChange={(e) => setGscProperty(e.target.value)} />
            <p className="text-xs text-slate-400 mt-1">אם Google מחובר, יש כפתור "בחר property" שמציג את הרשימה.</p>
          </div>
          <div>
            <label className="text-sm text-slate-600">GA4 Property ID</label>
            <input className="input" placeholder="123456789" value={ga4Id} onChange={(e) => setGa4Id(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-slate-600">הערות על העסק</label>
            <textarea className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {update.isError && <div className="text-rose-600 text-sm">שגיאה: {(update.error as any)?.message}</div>}

          <div className="flex justify-between gap-2 pt-2 border-t border-slate-100">
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={update.isPending}>
                {update.isPending ? "שומר..." : "שמור שינויים"}
              </button>
              <button type="button" className="btn-secondary" onClick={onClose}>ביטול</button>
            </div>
            {confirmDelete ? (
              <div className="flex gap-2 items-center">
                <span className="text-sm text-rose-600">למחוק את הלקוח לצמיתות?</span>
                <button type="button" className="btn-danger text-sm" onClick={() => del.mutate()} disabled={del.isPending}>
                  {del.isPending ? "מוחק..." : "כן, מחק"}
                </button>
                <button type="button" className="btn-secondary text-sm" onClick={() => setConfirmDelete(false)}>בטל</button>
              </div>
            ) : (
              <button type="button" className="text-rose-600 hover:bg-rose-50 px-3 py-1 rounded text-sm flex items-center gap-1" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> מחק לקוח
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
