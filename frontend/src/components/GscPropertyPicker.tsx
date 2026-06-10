import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, CheckCircle2, RefreshCw, Download } from "lucide-react";
import * as api from "../api";
import { Client } from "../api";
import Spinner from "./Spinner";

interface Props {
  client: Client;
  onClose: () => void;
}

export default function GscPropertyPicker({ client, onClose }: Props) {
  const qc = useQueryClient();
  const [selectedExtras, setSelectedExtras] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ["gsc-sites", client.id],
    queryFn: () => api.gscListSites(client.id),
  });

  const setProperty = useMutation({
    mutationFn: (siteUrl: string) => api.updateClient(client.id, { gsc_property: siteUrl }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard", client.id] });
      qc.invalidateQueries({ queryKey: ["client", client.id] });
    },
  });

  const bulkImport = useMutation({
    mutationFn: () => api.bulkImportGscProperties(client.id, Array.from(selectedExtras)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["gsc-sites", client.id] });
    },
  });

  const toggle = (siteUrl: string) => {
    const s = new Set(selectedExtras);
    s.has(siteUrl) ? s.delete(siteUrl) : s.add(siteUrl);
    setSelectedExtras(s);
  };

  const sites = data?.sites || [];

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="font-semibold text-lg">בחירת Property מ-Search Console</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
        </div>
        <div className="p-5">
          <p className="text-sm text-slate-600 mb-4">
            הרשימה הבאה היא ה-properties שחשבון ה-Google שלך רואה ב-Search Console.
            לחץ על אחד מהם כדי להגדיר אותו ללקוח <strong>{client.name}</strong>,
            או סמן כמה מהם בתחתית ולחץ "ייבא כלקוחות נוספים".
          </p>

          {isLoading && <Spinner label="טוען מ-Google..." />}
          {error && (
            <div className="text-rose-600 text-sm">שגיאה: {(error as any)?.message}</div>
          )}

          {sites.length > 0 && (
            <>
              <div className="text-xs text-slate-500 uppercase mb-2">הגדר ללקוח הנוכחי</div>
              <div className="space-y-1 mb-6">
                {sites.map((s) => {
                  const isCurrent = client.gsc_property === s.site_url;
                  return (
                    <button
                      key={s.site_url}
                      onClick={() => setProperty.mutate(s.site_url)}
                      disabled={setProperty.isPending || isCurrent}
                      className={`w-full flex items-center justify-between gap-2 p-2 rounded border text-right ${
                        isCurrent ? "bg-emerald-50 border-emerald-300" : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.site_url}</div>
                        <div className="text-xs text-slate-500">{s.permission_level}</div>
                      </div>
                      {isCurrent && <span className="badge bg-emerald-100 text-emerald-700"><CheckCircle2 size={12} /> נוכחי</span>}
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-slate-200 pt-4">
                <div className="text-xs text-slate-500 uppercase mb-2">ייבא כלקוחות נוספים (אופציונלי)</div>
                <p className="text-sm text-slate-600 mb-2">
                  סמן properties שאתה רוצה ליצור עבורם לקוחות חדשים. הם יקבלו את אותו חיבור Google.
                </p>
                <div className="max-h-[280px] overflow-y-auto space-y-1 mb-3">
                  {sites
                    .filter((s) => s.site_url !== client.gsc_property)
                    .map((s) => (
                      <label key={s.site_url} className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedExtras.has(s.site_url)}
                          onChange={() => toggle(s.site_url)}
                        />
                        <span className="text-sm truncate flex-1">{s.site_url}</span>
                        <span className="text-xs text-slate-400">{s.permission_level}</span>
                      </label>
                    ))}
                </div>
                <button
                  className="btn-primary"
                  disabled={selectedExtras.size === 0 || bulkImport.isPending}
                  onClick={() => bulkImport.mutate()}
                >
                  <Download size={16} /> {bulkImport.isPending ? "יוצר..." : `ייבא ${selectedExtras.size} לקוחות חדשים`}
                </button>
                {bulkImport.isSuccess && (
                  <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded p-3 text-sm text-emerald-800">
                    ✓ נוצרו {bulkImport.data.created_count} לקוחות חדשים
                    {bulkImport.data.skipped_count > 0 && ` (דולג ${bulkImport.data.skipped_count} כי כבר קיימים)`}
                  </div>
                )}
                {bulkImport.isError && (
                  <div className="mt-3 text-rose-600 text-sm">שגיאה: {(bulkImport.error as any)?.message}</div>
                )}
              </div>
            </>
          )}

          {!isLoading && sites.length === 0 && !error && (
            <p className="text-slate-500 text-sm">לא נמצאו properties בחשבון. ודא שהוספת אתרים ב-Search Console.</p>
          )}
        </div>
        <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => qc.invalidateQueries({ queryKey: ["gsc-sites", client.id] })}>
            <RefreshCw size={16} /> רענן רשימה
          </button>
          <button className="btn-primary" onClick={onClose}>סיום</button>
        </div>
      </div>
    </div>
  );
}
