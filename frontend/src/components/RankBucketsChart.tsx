import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import * as api from "../api";
import Spinner from "./Spinner";

const COLORS = ["#10b981", "#22c55e", "#eab308", "#f97316", "#ef4444"];
const LABELS = ["Top 1-3", "Top 4-10", "Top 11-30", "Top 31-100", "מחוץ ל-Top 100"];

export default function RankBucketsChart({ clientId }: { clientId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["rank-buckets", clientId],
    queryFn: () => api.zefoRankBuckets(clientId),
  });
  if (isLoading) return <Spinner />;
  if (!data || data.total === 0) return <p className="text-slate-500 text-sm">אין נתוני ZEFO. סנכרן קודם.</p>;
  const chartData = [
    { bucket: LABELS[0], count: data.top3 },
    { bucket: LABELS[1], count: data.top10 },
    { bucket: LABELS[2], count: data.top30 },
    { bucket: LABELS[3], count: data.top100 },
    { bucket: LABELS[4], count: data.unranked },
  ];
  return (
    <div>
      <div className="mb-2 text-sm text-slate-600">
        סה"כ {data.total} מילים — {data.top3 + data.top10} בעמוד ראשון של גוגל
      </div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} reversed />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ direction: "rtl", fontSize: 12 }} />
            <Bar dataKey="count" name="מספר מילים">
              {chartData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
