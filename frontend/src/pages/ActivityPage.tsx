import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, ExternalLink, Copy, Check, Printer, TrendingUp } from "lucide-react";
import * as api from "../api";
import type { ActivityEntry } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

function monthLabel(key: string): string {
  if (key === "—") return "ללא תאריך";
  try { return new Date(key + "-01T00:00:00").toLocaleDateString("he-IL", { year: "numeric", month: "long" }); } catch { return key; }
}
function yearAgo(): string { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); }

export default function ActivityPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const [from, setFrom] = useState(yearAgo());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [copied, setCopied] = useState(false);

  const { data: client } = useQuery({ queryKey: ["client", cid], queryFn: () => api.getClient(cid), enabled: !!cid });
  const { data: entries, isLoading } = useQuery({ queryKey: ["activity", cid], queryFn: () => api.getActivityLog(cid), enabled: !!cid });

  const inRange = (e: ActivityEntry) => !e.date || ((!from || e.date >= from) && (!to || e.date <= to + "T23:59:59"));
  const filtered = useMemo(() => (entries || []).filter(inRange), [entries, from, to]);

  const byMonth = useMemo(() => {
    const m = new Map<string, ActivityEntry[]>();
    for (const e of filtered) { const k = e.date ? e.date.slice(0, 7) : "—"; if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); }
    return [...m.entries()].sort((a, b) => (a[0] === "—" ? 1 : b[0] === "—" ? -1 : b[0].localeCompare(a[0])));
  }, [filtered]);

  const areaCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of filtered) c[e.area] = (c[e.area] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  function reportText(): string {
    const lines = [
      `דוח קידום אורגני — ${client?.name || ""}`,
      `תקופה: ${from} עד ${to}`,
      `סה"כ פעולות שבוצעו: ${filtered.length}`,
      "",
    ];
    for (const [k, items] of byMonth) {
      lines.push(`## ${monthLabel(k)} (${items.length})`);
      for (const e of items) {
        lines.push(`• [${e.area}] ${e.title}${e.page ? ` — ${e.page}` : ""}`);
        if (e.note) lines.push(`   ${e.note}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  function printReport() {
    const w = window.open("", "_blank"); if (!w) return;
    const rows = byMonth.map(([k, items]) => `
      <h2 style="margin:18px 0 6px;border-bottom:2px solid #6366f1;padding-bottom:4px">${monthLabel(k)} <span style="font-weight:normal;color:#666;font-size:14px">(${items.length})</span></h2>
      ${items.map((e) => `
        <div style="padding:8px 0;border-bottom:1px solid #eee">
          <div><span style="background:#eef;color:#3730a3;border-radius:6px;padding:1px 8px;font-size:12px">${e.area}</span> <strong>${e.title}</strong></div>
          ${e.page ? `<div style="font-size:12px;color:#2563eb">${e.page}</div>` : ""}
          ${e.note ? `<div style="font-size:13px;color:#444;margin-top:2px">${e.note}</div>` : ""}
          ${(e.impressions_before != null) ? `<div style="font-size:12px;color:#666;margin-top:2px">חשיפות: ${e.impressions_before} → ${e.impressions_now} · קליקים: ${e.clicks_before} → ${e.clicks_now}</div>` : ""}
        </div>`).join("")}`).join("");
    w.document.write(`<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>דוח קידום — ${client?.name || ""}</title>
      <style>body{font-family:Arial,Helvetica,sans-serif;max-width:800px;margin:24px auto;padding:0 16px;color:#111}</style></head>
      <body><h1 style="margin-bottom:2px">דוח קידום אורגני — ${client?.name || ""}</h1>
      <div style="color:#666;margin-bottom:16px">תקופה: ${from} עד ${to} · סה"כ ${filtered.length} פעולות</div>
      ${rows}
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  }

  return (
    <div>
      <PageHeader
        title="תיעוד ביצועים"
        subtitle={client ? `${client.name} · כל מה שבוצע — לדוח השנתי ללקוח` : "תיעוד ביצועים"}
        actions={
          <>
            <button className="btn-secondary" onClick={() => { navigator.clipboard.writeText(reportText()); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? <Check size={18} /> : <Copy size={18} />} {copied ? "הועתק" : "העתק דוח"}
            </button>
            <button className="btn-primary" onClick={printReport}><Printer size={18} /> הפק דוח שנתי (PDF)</button>
          </>
        }
      />

      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">מתאריך</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">עד תאריך</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex-1" />
        <div className="text-sm text-slate-600">סה"כ בתקופה: <span className="font-semibold text-slate-900">{filtered.length}</span></div>
      </div>

      {areaCounts.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {areaCounts.map(([a, n]) => <span key={a} className="badge bg-slate-100 text-slate-600">{a}: {n}</span>)}
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12 text-slate-500">
          <ClipboardList size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-slate-700 font-medium mb-1">אין פעולות מתועדות בתקופה</p>
          <p className="text-sm">ברגע שתבצע משימות/המלצות — הן יופיעו כאן אוטומטית.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {byMonth.map(([k, items]) => (
            <div key={k} className="card">
              <h3 className="font-semibold text-slate-800 mb-2">{monthLabel(k)} <span className="text-slate-400 text-sm font-normal">({items.length})</span></h3>
              <ul className="divide-y divide-slate-100">
                {items.map((e) => (
                  <li key={e.id} className="py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="badge bg-indigo-50 text-indigo-700">{e.area}</span>
                      <span className="font-medium text-slate-900">{e.title}</span>
                      {e.date && <span className="text-xs text-slate-400">{new Date(e.date).toLocaleDateString("he-IL")}</span>}
                    </div>
                    {e.page && <a href={e.page} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-0.5 mt-0.5 break-all"><ExternalLink size={11} /> {e.page.replace(/^https?:\/\/[^/]+/, "") || e.page}</a>}
                    {e.note && <div className="text-xs text-slate-500 mt-0.5 whitespace-pre-wrap">{e.note}</div>}
                    {e.impressions_before != null && (
                      <div className="text-xs text-slate-500 mt-0.5 inline-flex items-center gap-1"><TrendingUp size={11} className="text-emerald-500" /> חשיפות {e.impressions_before}→{e.impressions_now} · קליקים {e.clicks_before}→{e.clicks_now}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
