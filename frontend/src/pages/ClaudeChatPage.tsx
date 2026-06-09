import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, MessageSquare, Plus, Wrench, Trash2 } from "lucide-react";
import * as api from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

interface Msg { role: "user" | "assistant"; content: string; tool_calls?: any[] }

const SAMPLE_PROMPTS = [
  "מה המילים המובילות שלי לפי נפח חיפוש?",
  "כמה כניסות אורגניות היה למילה X בחודש האחרון?",
  "אילו עמודים מושכים הכי הרבה תנועה?",
  "תן לי ניתוח של ההזדמנויות שלי - מילים עם מיקום 5-15 ופוטנציאל שיפור",
];

export default function ClaudeChatPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [localMsgs, setLocalMsgs] = useState<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: sessions } = useQuery({
    queryKey: ["chat-sessions", cid],
    queryFn: () => api.listChatSessions(cid),
    enabled: !!cid,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [localMsgs.length]);

  useEffect(() => {
    if (sessionId && sessions) {
      const s = sessions.find((x) => x.id === sessionId);
      if (s) {
        setLocalMsgs((s.messages_json || []).map((m: any) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : "",
          tool_calls: m.tool_calls,
        })).filter((m: Msg) => m.content));
      }
    } else if (!sessionId) {
      setLocalMsgs([]);
    }
  }, [sessionId, sessions]);

  const send = useMutation({
    mutationFn: (message: string) => api.sendChat(cid, message, sessionId),
    onSuccess: (d, message) => {
      if (!sessionId) setSessionId(d.session_id);
      setLocalMsgs((prev) => [...prev, { role: "user", content: message }, { role: "assistant", content: d.reply, tool_calls: d.tool_calls }]);
      qc.invalidateQueries({ queryKey: ["chat-sessions", cid] });
    },
  });

  const delSession = useMutation({
    mutationFn: (id: number) => api.deleteChatSession(id),
    onSuccess: () => {
      setSessionId(null);
      setLocalMsgs([]);
      qc.invalidateQueries({ queryKey: ["chat-sessions", cid] });
    },
  });

  const handleSend = () => {
    if (!input.trim() || send.isPending) return;
    const msg = input.trim();
    setInput("");
    setLocalMsgs((prev) => [...prev, { role: "user", content: msg }]);
    send.mutate(msg);
  };

  return (
    <div>
      <PageHeader
        title="צ׳אט עם קלוד"
        subtitle="שאל את קלוד שאלות על הנתונים שלך — הוא ישלוף את התשובות מה-DB"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 h-[calc(100vh-220px)]">
        <div className="card overflow-y-auto">
          <button
            className="btn-secondary w-full justify-start mb-3 text-sm"
            onClick={() => { setSessionId(null); setLocalMsgs([]); }}
          >
            <Plus size={16} /> שיחה חדשה
          </button>
          <div className="space-y-1">
            {sessions?.map((s) => (
              <div
                key={s.id}
                className={`group flex items-center gap-1 px-2 py-2 rounded text-sm cursor-pointer ${sessionId === s.id ? "bg-brand-50 text-brand-700" : "hover:bg-slate-50"}`}
                onClick={() => setSessionId(s.id)}
              >
                <MessageSquare size={14} className="shrink-0" />
                <span className="truncate flex-1">{s.title}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600"
                  onClick={(e) => { e.stopPropagation(); delSession.mutate(s.id); }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!sessions?.length && <div className="text-xs text-slate-400 px-2 py-4 text-center">אין שיחות עדיין</div>}
          </div>
        </div>

        <div className="card flex flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 mb-3">
            {localMsgs.length === 0 ? (
              <div className="text-center py-8">
                <MessageSquare className="mx-auto text-slate-300 mb-3" size={48} />
                <p className="text-slate-500 mb-4">שאל את קלוד שאלה על הלקוח. הוא יודע לשלוף נתונים מ-DB ולנתח אותם.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl mx-auto">
                  {SAMPLE_PROMPTS.map((p) => (
                    <button
                      key={p}
                      className="text-right text-sm p-3 rounded-lg border border-slate-200 hover:border-brand-300 hover:bg-brand-50/50"
                      onClick={() => setInput(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              localMsgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2 whitespace-pre-wrap ${
                    m.role === "user" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-900"
                  }`}>
                    {m.content}
                    {m.tool_calls && m.tool_calls.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-300/40 text-xs opacity-70">
                        <div className="flex items-center gap-1 mb-1"><Wrench size={11} /> השתמש בכלים:</div>
                        {m.tool_calls.map((t, j) => (
                          <div key={j} className="font-mono text-[10px]">{t.name}({JSON.stringify(t.input)})</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {send.isPending && <Spinner label="קלוד חושב..." />}
            {send.isError && (
              <div className="text-rose-600 text-sm">שגיאה: {(send.error as any)?.message}</div>
            )}
          </div>

          <div className="flex gap-2 border-t border-slate-200 pt-3">
            <textarea
              className="input resize-none"
              rows={2}
              placeholder="שאל את קלוד..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button className="btn-primary" onClick={handleSend} disabled={!input.trim() || send.isPending}>
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
