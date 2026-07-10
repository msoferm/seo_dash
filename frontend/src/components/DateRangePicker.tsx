import { useState } from "react";

export interface DateRange {
  from: string;
  to: string;
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function rangeForDays(days: number): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: fmt(from), to: fmt(to) };
}

const PRESETS: { label: string; days: number }[] = [
  { label: "7 ימים", days: 7 },
  { label: "30 יום", days: 30 },
  { label: "90 יום", days: 90 },
  { label: "12 חודשים", days: 365 },
];

export default function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const [custom, setCustom] = useState(false);

  const activeDays = (() => {
    for (const p of PRESETS) {
      const r = rangeForDays(p.days);
      if (r.from === value.from && r.to === value.to) return p.days;
    }
    return null;
  })();

  const presetBtn = (active: boolean) =>
    `text-xs px-2 py-1 rounded ${
      active
        ? "bg-brand-600 text-white"
        : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {PRESETS.map((p) => (
        <button
          key={p.days}
          className={presetBtn(!custom && activeDays === p.days)}
          onClick={() => {
            setCustom(false);
            onChange(rangeForDays(p.days));
          }}
        >
          {p.label}
        </button>
      ))}
      <button className={presetBtn(custom)} onClick={() => setCustom((c) => !c)}>
        מותאם
      </button>
      {custom && (
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={value.from}
            max={value.to}
            className="text-xs border border-slate-300 rounded px-1 py-1 text-slate-700"
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <span className="text-xs text-slate-400">–</span>
          <input
            type="date"
            value={value.to}
            min={value.from}
            className="text-xs border border-slate-300 rounded px-1 py-1 text-slate-700"
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
