import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, CheckCircle2 } from "lucide-react";
import * as api from "../api";
import { Client } from "../api";
import Spinner from "./Spinner";

export default function Ga4PropertyPicker({ client, onClose }: { client: Client; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["ga4-properties", client.id],
    queryFn: () => api.ga4ListProperties(client.id),
  });

  const set = useMutation({
    mutationFn: (propertyId: string) => api.updateClient(client.id, { ga4_property_id: propertyId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client", client.id] });
      qc.invalidateQueries({ queryKey: ["dashboard", client.id] });
    },
  });

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="font-semibold text-lg">בחירת Property של Google Analytics 4</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
        </div>
        <div className="p-5">
          <p className="text-sm text-slate-600 mb-3">
            ה-properties שחשבון ה-Google שלך רואה ב-GA4.
          </p>
          {isLoading && <Spinner label="טוען מ-GA4..." />}
          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded p-3 text-sm text-rose-700">
              {(error as any)?.message}
            </div>
          )}
          {data && (
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {data.properties.map((p) => {
                const isCurrent = client.ga4_property_id === p.property_id;
                return (
                  <button
                    key={p.property_id}
                    onClick={() => set.mutate(p.property_id)}
                    disabled={set.isPending || isCurrent}
                    className={`w-full flex items-center justify-between gap-2 p-2 rounded border text-right ${
                      isCurrent ? "bg-emerald-50 border-emerald-300" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.display_name}</div>
                      <div className="text-xs text-slate-500">{p.parent_account} · ID: {p.property_id}</div>
                    </div>
                    {isCurrent && <span className="badge bg-emerald-100 text-emerald-700"><CheckCircle2 size={12} /> נוכחי</span>}
                  </button>
                );
              })}
              {data.properties.length === 0 && <p className="text-slate-400 italic">לא נמצאו properties.</p>}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-200 flex justify-end">
          <button className="btn-primary" onClick={onClose}>סיום</button>
        </div>
      </div>
    </div>
  );
}
