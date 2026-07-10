import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import * as api from "../api";
import Spinner from "./Spinner";

export default function OrganicTrafficChart({ clientId, from, to }: { clientId: number; from?: string; to?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["gsc-daily", clientId, from, to],
    queryFn: () => api.gscDaily(clientId, from, to),
  });
  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <p className="text-slate-500 text-sm">אין נתוני GSC. לחץ "סנכרן GSC" בראש הדף.</p>;

  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" reversed tick={{ fontSize: 11 }} />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="right" orientation="left" tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{ direction: "rtl", textAlign: "right", fontSize: 12 }}
            labelFormatter={(d) => `תאריך: ${d}`}
            formatter={(v: number, name: string) => [v.toLocaleString(), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line yAxisId="left" type="monotone" dataKey="clicks" name="קליקים" stroke="#10b981" strokeWidth={2} dot={false} />
          <Line yAxisId="right" type="monotone" dataKey="impressions" name="חשיפות" stroke="#3b82f6" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
