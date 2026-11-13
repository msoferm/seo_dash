import type { UploadPeriod } from "../api";

/** The period an uploaded file covers: auto-detected, last 3/6/12 months, or a free range. */
export type PeriodChoice = { kind: "auto" } | { kind: "months"; months: 3 | 6 | 12 } | { kind: "custom"; from: string; to: string };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function periodOf(c: PeriodChoice, today = new Date()): UploadPeriod | undefined {
  if (c.kind === "auto") return undefined;
  if (c.kind === "months") {
    const from = new Date(today); from.setMonth(from.getMonth() - c.months);
    return { date_from: ymd(from), date_to: ymd(today), period_label: `${c.months} חודשים אחרונים` };
  }
  if (!c.from || !c.to) return undefined;
  return { date_from: c.from, date_to: c.to, period_label: "טווח תאריכים שנבחר" };
}

export const fmtDay = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("he-IL") : "");
export function periodText(p: { date_from: string | null; date_to: string | null; period_label?: string | null }): string {
  if (!p.date_from && !p.date_to) return "";
  const range = `${fmtDay(p.date_from)} – ${fmtDay(p.date_to)}`;
  return p.period_label ? `${p.period_label} (${range})` : range;
}

export function loadChoice(cid: number): PeriodChoice {
  try { const v = JSON.parse(localStorage.getItem(`upload-period-${cid}`) || "null"); if (v?.kind) return v; } catch { /* ignore */ }
  return { kind: "auto" };
}
export function saveChoice(cid: number, c: PeriodChoice) {
  try { localStorage.setItem(`upload-period-${cid}`, JSON.stringify(c)); } catch { /* ignore */ }
}
