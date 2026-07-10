import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import * as api from "../api";
import Spinner from "./Spinner";

export default function Ga4TrafficChart({ clientId, from, to }: { clientId: number; from?: string; to?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["ga4-daily", clientId, from, to],
    queryFn: () => api.ga4Daily(clientId, from, to),
  });
  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <p className="text-slate-500 text-sm">אין נתוני GA4. ודא ש-GA4 Property ID מוגדר בלקוח ולחץ "סנכרן GA4".</p>;

  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" reversed tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{ direction: "rtl", textAlign: "right", fontSize: 12 }}
            formatter={(v: number, name: string) => [v.toLocaleString(), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="sessions" name="סשנים אורגניים" stroke="#8b5cf6" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="users" name="משתמשים" stroke="#f97316" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
