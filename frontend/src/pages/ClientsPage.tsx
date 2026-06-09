import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Globe, CheckCircle2, AlertCircle } from "lucide-react";
import * as api from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

function NewClientForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [notes, setNotes] = useState("");
  const [gscProperty, setGscProperty] = useState("");
  const [ga4Id, setGa4Id] = useState("");

  const mut = useMutation({
    mutationFn: () => api.createClient({
      name, domain, notes: notes || null,
      gsc_property: gscProperty || null,
      ga4_property_id: ga4Id || null,
    }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      navigate(`/clients/${c.id}`);
    },
  });

  return (
    <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}>
      <h3 className="font-semibold text-lg">לקוח חדש</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-slate-600">שם הלקוח</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-slate-600">דומיין (לדוגמה: example.co.il)</label>
          <input className="input" required value={domain} onChange={(e) => setDomain(e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-slate-600">GSC Property (אופציונלי, לדוגמה: sc-domain:example.co.il)</label>
          <input className="input" value={gscProperty} onChange={(e) => setGscProperty(e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-slate-600">GA4 Property ID (אופציונלי)</label>
          <input className="input" value={ga4Id} onChange={(e) => setGa4Id(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="text-sm text-slate-600">הערות על העסק (יעזרו לקלוד לכתוב FAQ טובים יותר)</label>
          <textarea className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 justify-start">
        <button type="submit" className="btn-primary" disabled={mut.isPending}>
          {mut.isPending ? "שומר..." : "הוסף לקוח"}
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>ביטול</button>
      </div>
      {mut.isError && <div className="text-rose-600 text-sm">שגיאה: {(mut.error as any)?.message}</div>}
    </form>
  );
}

export default function ClientsPage() {
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: api.listClients,
  });

  return (
    <div>
      <PageHeader
        title="לקוחות"
        subtitle="ניהול לקוחות SEO שלך"
        actions={
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            <Plus size={18} /> לקוח חדש
          </button>
        }
      />
      {showForm && <div className="mb-6"><NewClientForm onClose={() => setShowForm(false)} /></div>}
      {isLoading ? (
        <Spinner />
      ) : data && data.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.map((c) => (
            <a key={c.id} href={`/clients/${c.id}`} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-lg">{c.name}</div>
                  <div className="text-sm text-slate-500 flex items-center gap-1 mt-1">
                    <Globe size={14} /> {c.domain}
                  </div>
                </div>
                {c.google_token_json ? (
                  <span className="badge bg-emerald-50 text-emerald-700">
                    <CheckCircle2 size={12} /> Google מחובר
                  </span>
                ) : (
                  <span className="badge bg-amber-50 text-amber-700">
                    <AlertCircle size={12} /> לא מחובר
                  </span>
                )}
              </div>
              {c.notes && <p className="text-sm text-slate-600 mt-3 line-clamp-2">{c.notes}</p>}
            </a>
          ))}
        </div>
      ) : (
        <div className="card text-center py-12 text-slate-500">
          עדיין אין לקוחות. לחץ "לקוח חדש" כדי להתחיל.
        </div>
      )}
    </div>
  );
}
