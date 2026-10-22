import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MessageCircle, Send, Loader2, X, Bot } from "lucide-react";
import * as api from "../api";

type Msg = { role: "user" | "assistant"; text: string };
export type AssistantSeed = { title: string; context: string; nonce: number };

/** Slide-over AI assistant: ask anything about a task/recommendation (before/after it's done),
 *  consult, or give general instructions. Reuses the client chat (with SEO data tools). */
export default function TaskAssistant({ cid, open, onClose, seed }: {
  cid: number; open: boolean; onClose: () => void; seed: AssistantSeed | null;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [ctxTitle, setCtxTitle] = useState<string | null>(null);
  const [ctxStr, setCtxStr] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (seed) { setCtxTitle(seed.title); setCtxStr(seed.context); setInput(`לגבי "${seed.title}": `); }
  }, [seed?.nonce]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, open]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const prefix = ctxStr ? `[הקשר — ${ctxStr}]\n\n` : "";
      return api.sendChat(cid, prefix + text, sessionId);
    },
    onSuccess: (r) => { setSessionId(r.session_id); setMsgs((m) => [...m, { role: "assistant", text: r.reply }]); },
    onError: (e: any) => setMsgs((m) => [...m, { role: "assistant", text: `שגיאה: ${e?.message || ""}` }]),
  });

  function submit() {
    const text = input.trim(); if (!text || send.isPending) return;
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    send.mutate(text);
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-start" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div className="relative w-full max-w-md h-full bg-white shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Bot size={18} className="text-brand-600" /> עוזר AI למשימות</h3>
          <button className="text-slate-400 hover:text-slate-700 p-1" onClick={onClose}><X size={20} /></button>
        </div>

        {ctxTitle && (
          <div className="px-4 py-2 bg-indigo-50/60 border-b border-indigo-100 text-xs text-indigo-800 flex items-center justify-between gap-2">
            <span className="truncate">בהקשר: {ctxTitle}</span>
            <button className="text-indigo-500 hover:text-indigo-700 shrink-0" onClick={() => { setCtxTitle(null); setCtxStr(""); }}>נקה הקשר</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {msgs.length === 0 && (
            <div className="text-sm text-slate-400 text-center mt-6">
              שאל כל שאלה על משימה (לפני או אחרי ביצוע), התייעץ, או תן הוראות כלליות.
              <br />יש לי גישה לנתוני GSC / GA4 / מיקומים של הלקוח.
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"}`}>{m.text}</div>
            </div>
          ))}
          {send.isPending && <div className="flex justify-start"><div className="bg-slate-100 rounded-2xl px-3 py-2 text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> חושב...</div></div>}
          <div ref={endRef} />
        </div>

        <div className="p-3 border-t border-slate-200 flex gap-2">
          <textarea className="input flex-1 py-2 text-sm resize-none" rows={2} placeholder="כתוב הודעה..." value={input}
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <button className="btn-primary shrink-0 self-end" onClick={submit} disabled={send.isPending || !input.trim()}><Send size={16} /></button>
        </div>
      </div>
    </div>
  );
}

/** Floating button to open the assistant. */
export function AssistantFab({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="fixed bottom-6 left-6 z-30 btn-primary rounded-full shadow-lg h-14 px-5 flex items-center gap-2" title="עוזר AI">
      <MessageCircle size={20} /> עוזר AI
    </button>
  );
}
