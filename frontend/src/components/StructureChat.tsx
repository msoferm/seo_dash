import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bot, Send, Loader2, Trash2, User, ListPlus } from "lucide-react";
import * as api from "../api";
import type { StructureChatMsg } from "../api";
import { Md } from "./RichText";

const SUGGESTIONS = [
  "אילו מילות מפתח יש להן אותה כוונת משתמש וכדאי לשים אותן באותו עמוד? ולמה?",
  "איפה יש קניבליזציה באתר ואיך כדאי לפתור אותה?",
  "האם כדאי לבנות עמוד אב חדש לנושא מסוים, או להשתמש בעמוד קיים? תן דוגמה מהאתר.",
  "אילו מילים דורשות עמוד חדש נפרד, כי הכוונה שלהן שונה מכל עמוד קיים?",
];
const TO_REC = "הפוך את ההצעה האחרונה שלך בשיחה להמלצה ברשימת ההמלצות (propose_recommendation), עם שיקולים מלאים, מילים ופעולות.";

/** The conversation part of the structure advisor. Sees the latest combined analysis (hierarchy +
 *  recommendations) and can add a recommendation to it, so chat and analysis stay in sync. */
export default function StructureChat({ cid, from, to, ask, onAnswered }: {
  cid: number; from: string; to: string;
  ask?: { text: string; id: number } | null;          // a question pushed from a recommendation ("שאל על זה")
  onAnswered?: (proposed: string[]) => void;
}) {
  const storeKey = `structure-chat-${cid}`;
  const [msgs, setMsgs] = useState<StructureChatMsg[]>(() => {
    try { return JSON.parse(localStorage.getItem(storeKey) || "[]"); } catch { return []; }
  });
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastAsk = useRef<number | null>(null);

  useEffect(() => { try { localStorage.setItem(storeKey, JSON.stringify(msgs.slice(-40))); } catch { /* ignore */ } }, [msgs, storeKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [msgs.length]);

  const run = useMutation({
    mutationFn: (history: StructureChatMsg[]) => api.structureChat(cid, from, to, history),
    onSuccess: (r) => {
      const note = r.proposed?.length ? `\n\n---\n✅ **נוספה המלצה לרשימת ההמלצות** — אפשר לקבל אותה או לדחות בלשונית "המלצות".` : "";
      setMsgs((m) => [...m, { role: "assistant", content: r.reply + note }]);
      onAnswered?.(r.proposed || []);
    },
    onError: (e: Error) => setMsgs((m) => [...m, { role: "assistant", content: `⚠️ שגיאה: ${e.message}` }]),
  });

  const send = (text: string) => {
    const t = text.trim();
    if (!t || run.isPending) return;
    const history = [...msgs.filter((m) => !m.content.startsWith("⚠️")), { role: "user" as const, content: t }];
    setMsgs((m) => [...m, { role: "user", content: t }]);
    setInput("");
    run.mutate(history);
  };
  // A question pushed from a recommendation card.
  useEffect(() => { if (ask && ask.id !== lastAsk.current) { lastAsk.current = ask.id; send(ask.text); } }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          שיחה חופשית עם ה-AI. הוא מכיר את כל הנתונים, את טקסט הדפים מהסריקה, ואת מפת האתר וההמלצות של הניתוח הכולל. רעיון טוב מהשיחה אפשר להפוך בלחיצה להמלצה ברשימה.
        </p>
        {msgs.length > 0 && (
          <button className="text-xs text-slate-400 hover:text-rose-600 inline-flex items-center gap-1 shrink-0" onClick={() => { if (confirm("לנקות את השיחה?")) setMsgs([]); }}>
            <Trash2 size={12} /> שיחה חדשה
          </button>
        )}
      </div>

      {msgs.length > 0 && (
        <div className="mt-3 max-h-[620px] overflow-y-auto space-y-3 pl-1">
          {msgs.map((m, i) => (
            <div key={i} className="flex gap-2">
              <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${m.role === "user" ? "bg-slate-200 text-slate-600" : "bg-brand-100 text-brand-700"}`}>
                {m.role === "user" ? <User size={14} /> : <Bot size={14} />}
              </div>
              <div className={`rounded-lg px-3 py-2 min-w-0 flex-1 ${m.role === "user" ? "bg-slate-50 border border-slate-200 text-sm whitespace-pre-wrap" : "bg-white border border-brand-100"}`}>
                {m.role === "user" ? m.content : <Md text={m.content} />}
                {m.role === "assistant" && i === msgs.length - 1 && !m.content.startsWith("⚠️") && !run.isPending && (
                  <button className="mt-2 text-xs text-brand-700 hover:underline inline-flex items-center gap-1" onClick={() => send(TO_REC)}>
                    <ListPlus size={13} /> הפוך את ההצעה הזו להמלצה ברשימה
                  </button>
                )}
              </div>
            </div>
          ))}
          {run.isPending && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> מנתח את הנתונים… (עד דקה)</div>}
          <div ref={endRef} />
        </div>
      )}

      {msgs.length === 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="text-xs bg-brand-50 text-brand-700 border border-brand-100 rounded-full px-3 py-1 hover:bg-brand-100 text-right" onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 mt-3">
        <textarea
          className="input flex-1 min-h-[44px] max-h-40"
          rows={2}
          placeholder="שאל כל שאלה על סידור העמודים, כוונת משתמש, קניבליזציה… (Enter לשליחה, Shift+Enter לשורה חדשה)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
        />
        <button className="btn-primary shrink-0" disabled={!input.trim() || run.isPending} onClick={() => send(input)}>
          {run.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} שלח
        </button>
      </div>
    </div>
  );
}
