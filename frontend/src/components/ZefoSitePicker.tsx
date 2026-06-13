import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Search, CheckCircle2 } from "lucide-react";
import * as api from "../api";
import { Client } from "../api";
import Spinner from "./Spinner";

export default function ZefoSitePicker({ client, onClose }: { client: Client; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["zefo-sites"],
    queryFn: api.zefoListSites,
  });

  const link = useMutation({
    mutationFn: (zefoSiteId: number | null) => api.zefoLinkSite(client.id, zefoSiteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client", client.id] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["dashboard", client.id] });
    },
  });

  const filtered = (data?.sites || []).filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.domain.toLowerCase().includes(q) || (s.name || "").toLowerCase().includes(q);
  });

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="font-semibold text-lg">חיבור לאתר ב-ZEFO</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
        </div>
        <div className="p-5">
          <p className="text-sm text-slate-600 mb-3">
            רשימת האתרים בחשבון ZEFO. בחר את האתר שמתאים ללקוח <strong>{client.name}</strong>.
            ZEFO מספק מעקב מיקומים אמיתי בגוגל (יותר מדויק מ-GSC).
          </p>
          <div className="relative mb-3">
            <Search size={16} className="absolute right-3 top-3 text-slate-400" />
            <input className="input pr-9" placeholder="חפש לפי דומיין או שם..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {isLoading && <Spinner label="טוען מ-ZEFO..." />}
          {error && <div className="text-rose-600 text-sm">שגיאה: {(error as any)?.message}</div>}

          {data && (
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {filtered.map((s) => {
                const isCurrent = client.zefo_site_id === s.id;
                const linkedElsewhere = s.linked_client && s.linked_client.client_id !== client.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => link.mutate(s.id)}
                    disabled={link.isPending || isCurrent}
                    className={`w-full flex items-center justify-between gap-2 p-2 rounded border text-right ${
                      isCurrent ? "bg-emerald-50 border-emerald-300" :
                      linkedElsewhere ? "bg-slate-50 border-slate-200 opacity-60" :
                      "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{s.name || s.domain}</div>
                      <div className="text-xs text-slate-500 truncate">
                        {s.domain}{s.path ? `/${s.path}` : ""}
                        {linkedElsewhere && ` · מקושר ל-${s.linked_client!.client_name}`}
                      </div>
                    </div>
                    {isCurrent && <span className="badge bg-emerald-100 text-emerald-700"><CheckCircle2 size={12} /> נוכחי</span>}
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="text-slate-400 italic text-center py-4">לא נמצאו אתרים תואמים</p>
              )}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-200 flex justify-between gap-2">
          {client.zefo_site_id && (
            <button className="btn-secondary text-rose-600" onClick={() => { link.mutate(null); }}>
              נתק מ-ZEFO
            </button>
          )}
          <button className="btn-primary mr-auto" onClick={onClose}>סיום</button>
        </div>
      </div>
    </div>
  );
}
