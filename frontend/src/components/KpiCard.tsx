import { LucideIcon } from "lucide-react";

interface Props {
  title: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  color?: "blue" | "green" | "amber" | "rose";
}

const COLOR_MAP = {
  blue: "bg-blue-50 text-blue-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  rose: "bg-rose-50 text-rose-700",
};

export default function KpiCard({ title, value, hint, icon: Icon, color = "blue" }: Props) {
  return (
    <div className="card flex items-start justify-between">
      <div>
        <div className="text-sm text-slate-500">{title}</div>
        <div className="text-3xl font-bold mt-1">{value}</div>
        {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
      </div>
      {Icon && (
        <div className={`p-2 rounded-lg ${COLOR_MAP[color]}`}>
          <Icon size={22} />
        </div>
      )}
    </div>
  );
}
