import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, ChevronDown, ChevronUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import * as api from "../api";
import { Keyword } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

const MONTH_NAMES = ["", "ינו", "פבר", "מרץ", "אפר", "מאי", "יוני", "יולי", "אוג", "ספט", "אוק", "נוב", "דצמ"];

function KeywordRow({ k }: { k: Keyword }) {
  const [open, setOpen] = useState(false);
  const chartData = (k.monthly_history || [])
    .slice()
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .map((m) => ({
      name: `${MONTH_NAMES[m.month]} ${String(m.year).slice(2)}`,
      searches: m.searches,
    }));
  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <td className="py-3 font-medium">{k.term}</td>
        <td>{k.monthly_searches.toLocaleString()}</td>
        <td>{k.competition || "—"}</td>
        <td>{k.competition_index ?? "—"}</td>
        <td>{k.top_bid_low ? `₪${k.top_bid_low.toFixed(2)}` : "—"}</td>
        <td>{k.top_bid_high ? `₪${k.top_bid_high.toFixed(2)}` : "—"}</td>
        <td className="text-left">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</td>
      </tr>
      {open && (
        <tr className="bg-slate-50">
          <td colSpan={7} className="p-4">
            {chartData.length === 0 ? (
              <p className="text-slate-500 text-sm">אין היסטוריית חיפושים חודשית.</p>
            ) : (
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" reversed />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="searches" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function KeywordsPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["keywords", cid, search],
    queryFn: () => api.listKeywords(cid, search || undefined),
    enabled: !!cid,
  });

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadKeywordsCsv(cid, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keywords", cid] }),
  });

  return (
    <div>
      <PageHeader
        title="מילות מפתח"
        subtitle="העלה CSV של Google Keyword Planner וצפה בנתונים"
        actions={
          <>
            <input
              type="file"
              accept=".csv,.tsv,.txt"
              ref={fileRef}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
            <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              <Upload size={18} /> {upload.isPending ? "מעלה..." : "העלה CSV"}
            </button>
          </>
        }
      />

      {upload.isSuccess && (
        <div className="card mb-4 bg-emerald-50 border-emerald-200 text-emerald-800 text-sm">
          הועלו {(upload.data as any).inserted} מילות מפתח מהקובץ {(upload.data as any).filename}.
        </div>
      )}
      {upload.isError && (
        <div className="card mb-4 bg-rose-50 border-rose-200 text-rose-800 text-sm">
          שגיאה: {(upload.error as any)?.message}
        </div>
      )}

      <div className="card mb-4">
        <input
          className="input"
          placeholder="חפש מילת מפתח..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card">
        {isLoading ? (
          <Spinner />
        ) : !data || data.length === 0 ? (
          <p className="text-center text-slate-500 py-8">אין מילות מפתח. העלה קובץ CSV כדי להתחיל.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-right text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2">מילה</th>
                <th>נפח חודשי</th>
                <th>תחרות</th>
                <th>אינדקס תחרות</th>
                <th>מחיר מינ׳</th>
                <th>מחיר מקס׳</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((k) => <KeywordRow key={k.id} k={k} />)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
