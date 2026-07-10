import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search, ExternalLink, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import * as api from "../api";
import type { ZefoKeyword } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import RankBucketsChart from "../components/RankBucketsChart";

type SortKey = "keyword" | "volume" | "change" | "rank";

function deltaOf(k: ZefoKeyword): number | null {
  if (k.ranking == null || k.previous_ranking == null) return null;
  return k.previous_ranking - k.ranking; // positive = moved up (improved)
}

/** "+5" green (rose in rank improved), "-3" red, "0" gray, "—" when unknown. */
function ChangeCell({ k }: { k: ZefoKeyword }) {
  const d = deltaOf(k);
  if (d === null) return <span className="text-slate-400">—</span>;
  if (d === 0) return <span className="text-slate-400">0</span>;
  if (d > 0) return <span className="text-emerald-600 font-semibold">+{d}</span>;
  return <span className="text-rose-600 font-semibold">{d}</span>; // d already negative
}

function normUrl(u: string): string {
  try {
    const x = new URL(u);
    return (x.host.replace(/^www\./, "") + x.pathname.replace(/\/$/, "")).toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}
function pageNameFromUrl(u: string): string {
  try {
    const x = new URL(u);
    const path = decodeURIComponent(x.pathname).replace(/\/$/, "");
    if (!path) return x.host.replace(/^www\./, "");
    return path.split("/").filter(Boolean).pop() || path;
  } catch {
    return u;
  }
}

function SortHead({
  label, col, sortKey, sortDir, onSort, className = "",
}: {
  label: string; col: SortKey; sortKey: SortKey | null; sortDir: "asc" | "desc";
  onSort: (c: SortKey) => void; className?: string;
}) {
  const active = sortKey === col;
  return (
    <th className={className}>
      <button onClick={() => onSort(col)} className="inline-flex items-center gap-1 hover:text-slate-700">
        {label}
        {active
          ? (sortDir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />)
          : <ChevronsUpDown size={12} className="text-slate-300" />}
      </button>
    </th>
  );
}

export default function RankingsPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const { data: client } = useQuery({
    queryKey: ["client", cid],
    queryFn: () => api.getClient(cid),
  });
  const { data: keywords, isLoading } = useQuery({
    queryKey: ["zefo-keywords", cid, search],
    queryFn: () => api.listZefoKeywords(cid, search || undefined),
  });
  // Crawled pages → map URL to its title, so "עמוד מדורג" can show a readable name.
  const { data: pages } = useQuery({
    queryKey: ["pages", cid],
    queryFn: () => api.listPages(cid),
  });

  const titleMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pages || []) {
      if (p.title) m.set(normUrl(p.url), p.title);
    }
    return m;
  }, [pages]);

  const sync = useMutation({
    mutationFn: () => api.zefoSync(cid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["zefo-keywords", cid] });
      qc.invalidateQueries({ queryKey: ["rank-buckets", cid] });
    },
  });

  function onSort(col: SortKey) {
    if (col === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      // sensible default direction per column
      setSortDir(col === "rank" || col === "keyword" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    const arr = [...(keywords || [])];
    const val = (k: ZefoKeyword): number | string | null => {
      switch (sortKey) {
        case "keyword": return k.keyword || "";
        case "volume": return k.local_searches ?? null;
        case "change": return deltaOf(k);
        case "rank": return k.ranking ?? null;
      }
    };
    arr.sort((a, b) => {
      const va = val(a), vb = val(b);
      const na = va === null || va === undefined;
      const nb = vb === null || vb === undefined;
      if (na && nb) return 0;
      if (na) return 1;  // nulls always last
      if (nb) return -1;
      let cmp: number;
      if (typeof va === "string") cmp = (va as string).localeCompare(vb as string, "he");
      else cmp = (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [keywords, sortKey, sortDir]);

  const linked = !!client?.zefo_site_id;

  return (
    <div>
      <PageHeader
        title="מעקב מיקומים (ZEFO)"
        subtitle={client?.name || ""}
        actions={
          linked && (
            <button className="btn-primary" onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw size={18} className={sync.isPending ? "animate-spin" : ""} /> סנכרן מ-ZEFO
            </button>
          )
        }
      />

      {!linked && (
        <div className="card mb-4 bg-amber-50 border-amber-200 text-amber-800 text-sm">
          הלקוח עדיין לא מקושר לאתר ZEFO. לחץ "ערוך לקוח" בדף הסקירה, ובחר Property מ-ZEFO.
        </div>
      )}

      {sync.isSuccess && (
        <div className="card mb-4 bg-emerald-50 border-emerald-200 text-emerald-800 text-sm">
          סונכרנו {(sync.data as any).synced} מילות מפתח מ-ZEFO.
        </div>
      )}
      {sync.isError && (
        <div className="card mb-4 bg-rose-50 border-rose-200 text-rose-800 text-sm">
          שגיאה: {(sync.error as any)?.message}
        </div>
      )}

      {linked && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="card">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Search size={18} /> חלוקת מיקומים</h3>
            <RankBucketsChart clientId={cid} />
          </div>
          <div className="card">
            <h3 className="font-semibold mb-3">ההזדמנויות שלך</h3>
            <p className="text-slate-500 text-sm mb-3">מילים במיקום 4-15 - עוד דחיפה קטנה ויעלו לעמוד הראשון.</p>
            {keywords && (
              <ul className="space-y-1 text-sm">
                {keywords
                  .filter((k) => k.ranking !== null && k.ranking >= 4 && k.ranking <= 15)
                  .slice(0, 10)
                  .map((k) => (
                    <li key={k.id} className="flex justify-between border-b border-slate-100 py-1 last:border-0">
                      <span className="truncate flex-1">{k.keyword}</span>
                      <span className="font-medium text-amber-700 shrink-0">#{k.ranking}</span>
                    </li>
                  ))}
                {keywords.filter((k) => k.ranking !== null && k.ranking >= 4 && k.ranking <= 15).length === 0 && (
                  <li className="text-slate-400 italic">אין מילים במיקומים 4-15</li>
                )}
              </ul>
            )}
          </div>
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
        {isLoading ? <Spinner /> : !sorted || sorted.length === 0 ? (
          <p className="text-center text-slate-500 py-8">אין מילים. {linked && "לחץ \"סנכרן מ-ZEFO\" כדי להתחיל."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-right text-slate-500 border-b border-slate-200">
                <tr>
                  <SortHead label="מילה" col="keyword" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="py-2" />
                  <SortHead label="נפח חיפושים" col="volume" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <th>עמוד מדורג</th>
                  <SortHead label="שינוי" col="change" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortHead label="מיקום נוכחי" col="rank" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((k) => {
                  const label = (k.rank_page && titleMap.get(normUrl(k.rank_page))) || (k.rank_page ? pageNameFromUrl(k.rank_page) : "");
                  return (
                    <tr key={k.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 font-medium">{k.keyword}</td>
                      <td>{k.local_searches?.toLocaleString() || "—"}</td>
                      <td className="text-xs">
                        {k.rank_page ? (
                          <a
                            href={k.rank_page}
                            target="_blank"
                            rel="noreferrer"
                            title={k.rank_page}
                            className="text-brand-700 hover:underline inline-flex items-center gap-1 max-w-[320px]"
                          >
                            <ExternalLink size={11} className="shrink-0" />
                            <span className="truncate">{label}</span>
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td><ChangeCell k={k} /></td>
                      <td>
                        <span className={`font-semibold ${
                          k.ranking && k.ranking <= 3 ? "text-emerald-600" :
                          k.ranking && k.ranking <= 10 ? "text-emerald-500" :
                          k.ranking && k.ranking <= 30 ? "text-amber-600" :
                          "text-slate-400"
                        }`}>
                          {k.ranking ? `#${k.ranking}` : "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
