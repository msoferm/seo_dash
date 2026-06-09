import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Sparkles, RefreshCw, Lightbulb, ChevronLeft, AlertCircle, Download } from "lucide-react";
import * as api from "../api";
import { PageRow, FaqItem, Client } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

type Step = "crawl" | "select" | "review";

function CrawlStep({ clientId, onDone }: { clientId: number; onDone: (pages: PageRow[]) => void }) {
  const { data: client } = useQuery<Client | null>({
    queryKey: ["client", clientId],
    queryFn: () => api.getClient(clientId),
  });
  const [url, setUrl] = useState("");

  const crawl = useMutation({
    mutationFn: () => api.crawlSite(clientId, url || undefined),
    onSuccess: (pages) => onDone(pages),
  });

  return (
    <div className="card max-w-2xl">
      <h2 className="font-semibold text-lg mb-2">שלב 1 — סריקת האתר</h2>
      <p className="text-slate-500 text-sm mb-4">
        הכלי ימשוך את sitemap.xml מהאתר וייצר רשימה של כל העמודים. אתה תבחר עבור איזה עמודים אתה רוצה ליצור FAQ.
      </p>
      <div className="space-y-3">
        <div>
          <label className="text-sm text-slate-600">URL לאתר (ברירת מחדל: דומיין הלקוח)</label>
          <input
            className="input"
            placeholder={client?.domain || "https://example.com"}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <button className="btn-primary" onClick={() => crawl.mutate()} disabled={crawl.isPending}>
          {crawl.isPending ? <><RefreshCw size={18} className="animate-spin" /> סורק...</> : <><Search size={18} /> סרוק את האתר</>}
        </button>
        {crawl.isError && (
          <div className="text-rose-600 text-sm">{(crawl.error as any)?.message}</div>
        )}
      </div>
    </div>
  );
}

function SelectStep({ pages, onSelect }: { pages: PageRow[]; onSelect: (ids: number[], ctx: string) => void }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [context, setContext] = useState("");
  const toggle = (id: number) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };
  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="font-semibold text-lg mb-2">שלב 2 — בחירת עמודים ליצירת FAQ</h2>
        <p className="text-slate-500 text-sm mb-4">
          סמן את העמודים שאתה רוצה שקלוד יכתוב להם FAQ. לכל עמוד הוא יכתוב 3-4 שאלות כלליות + 4-6 שאלות ספציפיות לעמוד + שאלת CTA.
        </p>
        <div>
          <label className="text-sm text-slate-600">הקשר עסקי נוסף (אופציונלי — יעזור לקלוד לכתוב תשובות מדויקות יותר):</label>
          <textarea className="input min-h-[80px]" value={context} onChange={(e) => setContext(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="flex justify-between items-center mb-3">
          <div className="font-medium">{pages.length} עמודים נמצאו · {selected.size} נבחרו</div>
          <button
            className="btn-secondary text-sm"
            onClick={() => setSelected(selected.size === pages.length ? new Set() : new Set(pages.map((p) => p.id)))}
          >
            {selected.size === pages.length ? "בטל בחירה" : "בחר הכל"}
          </button>
        </div>
        <div className="max-h-[400px] overflow-y-auto space-y-1">
          {pages.map((p) => (
            <label key={p.id} className="flex items-start gap-3 p-2 rounded hover:bg-slate-50 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.title || p.url}</div>
                <div className="text-xs text-slate-500 truncate">{p.url}</div>
              </div>
              {p.has_faq && <span className="badge bg-emerald-50 text-emerald-700 shrink-0">יש FAQ</span>}
            </label>
          ))}
        </div>
      </div>

      <button
        className="btn-primary"
        disabled={selected.size === 0}
        onClick={() => onSelect(Array.from(selected), context)}
      >
        <Sparkles size={18} /> צור FAQ ל-{selected.size} עמודים
      </button>
    </div>
  );
}

function PageFaqEditor({ page }: { page: PageRow }) {
  const qc = useQueryClient();
  const [additional, setAdditional] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);

  const { data: items, isLoading } = useQuery({
    queryKey: ["faq", page.id],
    queryFn: () => api.listFaqs(page.id),
  });

  const refine = useMutation({
    mutationFn: () => api.refineFaq(page.id, additional),
    onSuccess: () => {
      setAdditional("");
      qc.invalidateQueries({ queryKey: ["faq", page.id] });
    },
  });

  const suggest = useMutation({
    mutationFn: () => api.suggestMoreFaqs(page.id),
    onSuccess: (d) => setSuggestions(d.suggestions),
  });

  const missing = items?.find((i) => i.missing_info)?.missing_info;

  if (isLoading) return <Spinner />;

  return (
    <div className="card space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <div className="font-semibold">{page.title || "ללא כותרת"}</div>
          <a href={page.url} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline">{page.url}</a>
        </div>
        <button
          className="btn-secondary text-sm"
          onClick={() => {
            const text = items?.map((i) => `שאלה: ${i.question}\nתשובה: ${i.answer}\n`).join("\n") || "";
            navigator.clipboard.writeText(text);
          }}
        >
          <Download size={14} /> העתק את הכל
        </button>
      </div>

      {missing && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
          <div className="flex items-center gap-2 text-amber-800 font-medium mb-1">
            <AlertCircle size={16} /> מידע חסר שלדעת קלוד יעזור לכתוב תשובות טובות יותר:
          </div>
          <pre className="whitespace-pre-wrap text-amber-900 text-xs">{missing}</pre>
          <div className="mt-3 space-y-2">
            <textarea
              className="input text-sm"
              placeholder="הזן כאן את המידע החסר ונשכתב את ה-FAQ..."
              value={additional}
              onChange={(e) => setAdditional(e.target.value)}
            />
            <button
              className="btn-primary text-sm"
              onClick={() => refine.mutate()}
              disabled={!additional || refine.isPending}
            >
              {refine.isPending ? "משכתב..." : "שכתב עם המידע החדש"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {items?.map((item: FaqItem) => (
          <div key={item.id} className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-start justify-between gap-3 mb-2">
              <span className={`badge ${
                item.kind === "general" ? "bg-blue-50 text-blue-700" :
                item.kind === "specific" ? "bg-purple-50 text-purple-700" :
                "bg-amber-50 text-amber-700"
              }`}>
                {item.kind === "general" ? "כללי על העסק" : item.kind === "specific" ? "ספציפי לעמוד" : "Call to Action"}
              </span>
            </div>
            <div className="font-medium text-slate-900">{item.question}</div>
            <div className="text-slate-700 text-sm mt-1">{item.answer}</div>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-200 pt-3">
        <button className="btn-secondary text-sm" onClick={() => suggest.mutate()} disabled={suggest.isPending}>
          <Lightbulb size={16} /> {suggest.isPending ? "מחפש שאילתות..." : "הצע שאלות נוספות לפי שאילתות חיפוש"}
        </button>
        {suggestions.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="text-sm font-medium text-slate-700">הצעות נוספות ({suggestions.length}):</div>
            {suggestions.map((s, i) => (
              <div key={i} className="border border-dashed border-slate-300 rounded-lg p-3 text-sm">
                <div className="font-medium">{s.question}</div>
                <div className="text-slate-600 mt-1">{s.answer}</div>
                {s.based_on_query && <div className="text-xs text-slate-400 mt-1">מבוסס על: {s.based_on_query}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FaqGeneratorPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("crawl");
  const [pages, setPages] = useState<PageRow[]>([]);
  const [generatedPageIds, setGeneratedPageIds] = useState<number[]>([]);

  const { data: existingPages } = useQuery({
    queryKey: ["pages", cid],
    queryFn: () => api.listPages(cid),
    enabled: !!cid,
  });

  const generate = useMutation({
    mutationFn: ({ ids, ctx }: { ids: number[]; ctx: string }) =>
      api.generateFaq(ids, ctx || null),
    onSuccess: (_, vars) => {
      setGeneratedPageIds(vars.ids);
      setStep("review");
      qc.invalidateQueries({ queryKey: ["pages", cid] });
    },
  });

  const reviewPages = pages.length > 0
    ? pages.filter((p) => generatedPageIds.includes(p.id))
    : (existingPages || []).filter((p) => generatedPageIds.includes(p.id));

  return (
    <div>
      <PageHeader
        title="FAQ Generator"
        subtitle="צור עמודי שאלות-תשובות אוטומטית עם קלוד"
        actions={
          step !== "crawl" && (
            <button className="btn-secondary" onClick={() => { setStep("crawl"); setPages([]); }}>
              <ChevronLeft size={18} /> התחל מחדש
            </button>
          )
        }
      />

      <div className="flex items-center gap-2 mb-6 text-sm">
        {(["crawl", "select", "review"] as Step[]).map((s, i) => (
          <div key={s} className={`flex items-center gap-2 ${step === s ? "text-brand-700 font-semibold" : "text-slate-400"}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center ${step === s ? "bg-brand-600 text-white" : "bg-slate-200"}`}>
              {i + 1}
            </div>
            {s === "crawl" ? "סריקה" : s === "select" ? "בחירה" : "תוצאות"}
            {i < 2 && <span className="mx-1">←</span>}
          </div>
        ))}
      </div>

      {step === "crawl" && (
        <>
          <CrawlStep clientId={cid} onDone={(p) => { setPages(p); setStep("select"); }} />
          {existingPages && existingPages.length > 0 && (
            <div className="mt-4 text-sm text-slate-500">
              ({existingPages.length} עמודים כבר במאגר —{" "}
              <button className="text-brand-700 hover:underline" onClick={() => { setPages(existingPages); setStep("select"); }}>
                דלג והשתמש בהם
              </button>)
            </div>
          )}
        </>
      )}

      {step === "select" && (
        <>
          {generate.isError && (
            <div className="card mb-4 bg-rose-50 border-rose-200 text-rose-800 text-sm">
              שגיאה: {(generate.error as any)?.message}
            </div>
          )}
          <SelectStep
            pages={pages.length > 0 ? pages : (existingPages || [])}
            onSelect={(ids, ctx) => generate.mutate({ ids, ctx })}
          />
          {generate.isPending && (
            <div className="card mt-4">
              <Spinner label={`קלוד יוצר FAQ ל-${(generate.variables as any)?.ids?.length || 0} עמודים — זה לוקח כדקה לעמוד...`} />
            </div>
          )}
        </>
      )}

      {step === "review" && (
        <div className="space-y-4">
          {reviewPages.map((p) => <PageFaqEditor key={p.id} page={p} />)}
        </div>
      )}
    </div>
  );
}
