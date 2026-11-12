import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bot, Send, Loader2, Trash2, ChevronDown, ChevronUp, User } from "lucide-react";
import * as api from "../api";
import type { StructureChatMsg } from "../api";

const SUGGESTIONS = [
  "אילו מילות מפתח יש להן אותה כוונת משתמש וכדאי לשים אותן באותו עמוד? ולמה?",
  "איפה יש קניבליזציה באתר ואיך כדאי לפתור אותה?",
  "אילו מילים עדיין לא שויכו לעמוד יעד, ולאיזה עמוד הכי מתאים לשייך כל אחת?",
  "אילו מילים דורשות עמוד חדש נפרד, כי הכוונה שלהן שונה מכל עמוד קיים?",
];

/** Inline **bold** support. */
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>);
}

/** Minimal markdown: headings, bullet/numbered lists, tables, bold. */
export function Md({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const tbl: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) tbl.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      i--;
      out.push(
        <div key={i} className="overflow-x-auto my-2">
          <table className="text-xs border border-slate-200">
            <tbody>{tbl.map((r, ri) => <tr key={ri} className={ri === 0 ? "bg-slate-100 font-medium" : "border-t border-slate-100"}>{r.map((c, ci) => <td key={ci} className="px-2 py-1 align-top">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>);
      continue;
    }
    const h = l.match(/^#{1,4}\s+(.*)/);
    if (h) { out.push(<div key={i} className="font-semibold text-slate-900 mt-3 mb-1">{inline(h[1])}</div>); continue; }
    const b = l.match(/^(\s*)([-*•]|\d+\.)\s+(.*)/);
    if (b) {
      out.push(<div key={i} className="flex gap-1.5" style={{ paddingRight: b[1].length * 6 }}><span className="text-slate-400 shrink-0">{/\d/.test(b[2]) ? b[2] : "•"}</span><span>{inline(b[3])}</span></div>);
      continue;
    }
    if (/^\s*---+\s*$/.test(l)) { out.push(<hr key={i} className="my-2 border-slate-200" />); continue; }
    out.push(l.trim() ? <div key={i}>{inline(l)}</div> : <div key={i} className="h-2" />);
  }
  return <div className="text-sm leading-relaxed text-slate-800">{out}</div>;
}

/** AI consultant at the top of the structure tab — knows the client's keywords, pages,
 *  rankings, cannibalization, target decisions and user-intent analyses (server snapshot). */
export default function StructureChat({ cid, from, to }: { cid: number; from: string; to: string }) {
  const storeKey = `structure-chat-${cid}`;
  const [msgs, setMsgs] = useState<StructureChatMsg[]>(() => {
    try { return JSON.parse(localStorage.getItem(storeKey) || "[]"); } catch { return []; }
  });
  const [open, setOpen] = useState(true);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { try { localStorage.setItem(storeKey, JSON.stringify(msgs.slice(-40))); } catch { /* ignore */ } }, [msgs, storeKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [msgs.length]);

  const ask = useMutation({
    mutationFn: (history: StructureChatMsg[]) => api.structureChat(cid, from, to, history),
    onSuccess: (r) => setMsgs((m) => [...m, { role: "assistant", content: r.reply }]),
    onError: (e: Error) => setMsgs((m) => [...m, { role: "assistant", content: `⚠️ שגיאה: ${e.message}` }]),
  });

  const send = (text: string) => {
    const t = text.trim();
    if (!t || ask.isPending) return;
    const history = [...msgs.filter((m) => !m.content.startsWith("⚠️")), { role: "user" as const, content: t }];
    setMsgs((m) => [...m, { role: "user", content: t }]);
    setInput("");
    ask.mutate(history);
  };

  return (
    <div className="card mb-4 border-r-4 border-r-brand-400">
      <div className="flex items-center justify-between gap-2">
        <button className="font-semibold flex items-center gap-2 text-slate-800" onClick={() => setOpen((o) => !o)}>
          <Bot size={18} className="text-brand-600" /> התייעצות עם AI על מבנה האתר
          {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        {msgs.length > 0 && open && (
          <button className="text-xs text-slate-400 hover:text-rose-600 inline-flex items-center gap-1" onClick={() => { if (confirm("לנקות את השיחה?")) setMsgs([]); }}>
            <Trash2 size={12} /> שיחה חדשה
          </button>
        )}
      </div>
      {open && (
        <>
          <p className="text-xs text-slate-500 mt-1">
            ה-AI מכיר את כל מילות המפתח, העמודים המדורגים, המיקומים והחשיפות (בטווח התאריכים שנבחר למטה), הקניבליזציה, החלטות היעד, ביטויי המשנה וניתוחי כוונת המשתמש. הוא רק מייעץ, ולא משנה שום דבר.
          </p>

          {msgs.length > 0 && (
            <div className="mt-3 max-h-[520px] overflow-y-auto space-y-3 pl-1">
              {msgs.map((m, i) => (
                <div key={i} className={`flex gap-2 ${m.role === "user" ? "" : ""}`}>
                  <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${m.role === "user" ? "bg-slate-200 text-slate-600" : "bg-brand-100 text-brand-700"}`}>
                    {m.role === "user" ? <User size={14} /> : <Bot size={14} />}
                  </div>
                  <div className={`rounded-lg px-3 py-2 min-w-0 flex-1 ${m.role === "user" ? "bg-slate-50 border border-slate-200 text-sm whitespace-pre-wrap" : "bg-white border border-brand-100"}`}>
                    {m.role === "user" ? m.content : <Md text={m.content} />}
                  </div>
                </div>
              ))}
              {ask.isPending && (
                <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> מנתח את הנתונים… (עד דקה)</div>
              )}
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
            <button className="btn-primary shrink-0" disabled={!input.trim() || ask.isPending} onClick={() => send(input)}>
              {ask.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} שלח
            </button>
          </div>
        </>
      )}
    </div>
  );
}
