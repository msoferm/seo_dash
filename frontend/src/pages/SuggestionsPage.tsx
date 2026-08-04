import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Paperclip, Download, Trash2, Plus, Loader2, X, Pencil, Check, MessageSquare, Send } from "lucide-react";
import * as api from "../api";
import type { Suggestion, SuggestionAttachment, SuggestionStatus, SuggestionComment } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

type Author = "moshe" | "mordechai";

const AUTHOR_LABEL: Record<Author, string> = {
  moshe: "משה",
  mordechai: "מרדכי",
};

const AUTHOR_BADGE: Record<Author, string> = {
  moshe: "bg-blue-50 text-blue-700",
  mordechai: "bg-purple-50 text-purple-700",
};

const STATUS_META: Record<SuggestionStatus, { label: string; badge: string; border: string }> = {
  open: { label: "פתוח", badge: "bg-slate-100 text-slate-600", border: "border-r-slate-200" },
  in_progress: { label: "בטיפול", badge: "bg-amber-50 text-amber-700", border: "border-r-amber-400" },
  done: { label: "בוצע", badge: "bg-emerald-50 text-emerald-700", border: "border-r-emerald-400" },
};
const STATUS_ORDER: SuggestionStatus[] = ["open", "in_progress", "done"];

function isImage(att: SuggestionAttachment): boolean {
  return (att.type || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(att.name);
}

/** Thumbnail for an image attachment (private bucket → needs a signed URL). */
function ImageThumb({ att, onOpen }: { att: SuggestionAttachment; onOpen: (url: string, name: string) => void }) {
  const { data: url } = useQuery({
    queryKey: ["sig", att.path],
    queryFn: () => api.suggestionFileUrl(att.path),
    staleTime: 50 * 60 * 1000, // signed URL valid ~60min
  });
  if (!url) {
    return <div className="h-24 w-24 rounded-lg border border-slate-200 bg-slate-100 animate-pulse" />;
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(url, att.name)}
      title={att.name}
      className="block h-24 w-24 overflow-hidden rounded-lg border border-slate-200 cursor-zoom-in hover:opacity-90 transition-opacity"
    >
      <img src={url} alt={att.name} className="h-full w-full object-cover" />
    </button>
  );
}

/** One comment in the thread — anyone on the team can edit or delete any comment. */
function CommentItem({ c, onEdit, onDelete }: {
  c: SuggestionComment;
  onEdit: (id: number, body: string) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);

  function save() {
    if (draft.trim()) onEdit(c.id, draft);
    setEditing(false);
  }

  return (
    <li className="flex items-start gap-2 group">
      <span className={`badge ${AUTHOR_BADGE[c.author]} shrink-0 mt-0.5`}>{AUTHOR_LABEL[c.author]}</span>
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <textarea className="input py-1.5 text-sm" rows={2} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-primary text-xs py-1" onClick={save}><Check size={13} /> שמור</button>
              <button className="btn-secondary text-xs py-1" onClick={() => { setDraft(c.body); setEditing(false); }}>ביטול</button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-sm text-slate-700 whitespace-pre-wrap break-words">{c.body}</div>
            <div className="text-[11px] text-slate-400">{new Date(c.created_at).toLocaleString("he-IL")}</div>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex items-center opacity-0 group-hover:opacity-100 shrink-0">
          <button className="text-slate-300 hover:text-brand-600 transition-colors p-1" title="ערוך תגובה" onClick={() => { setDraft(c.body); setEditing(true); }}>
            <Pencil size={13} />
          </button>
          <button className="text-slate-300 hover:text-rose-600 transition-colors p-1" title="מחק תגובה" onClick={() => onDelete(c.id)}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </li>
  );
}

function SuggestionCard({ s, author, onDelete, onOpenImage, onUpdateBody, onSetStatus, onAddComment, onEditComment, onDeleteComment }: {
  s: Suggestion;
  author: Author;
  onDelete: () => void;
  onOpenImage: (url: string, name: string) => void;
  onUpdateBody: (id: number, body: string) => void;
  onSetStatus: (id: number, status: SuggestionStatus) => void;
  onAddComment: (suggestionId: number, body: string) => void;
  onEditComment: (id: number, body: string) => void;
  onDeleteComment: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(s.body || "");
  const [comment, setComment] = useState("");

  async function openFile(path: string) {
    const url = await api.suggestionFileUrl(path);
    window.open(url, "_blank");
  }

  function saveEdit() {
    onUpdateBody(s.id, editBody);
    setEditing(false);
  }

  function submitComment() {
    if (!comment.trim()) return;
    onAddComment(s.id, comment);
    setComment("");
  }

  const images = (s.attachments || []).filter(isImage);
  const others = (s.attachments || []).filter((a) => !isImage(a));
  const comments = s.comments || [];

  return (
    <div className={`card border-r-4 ${STATUS_META[s.status].border}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`badge ${AUTHOR_BADGE[s.author]}`}>{AUTHOR_LABEL[s.author]}</span>
          <span className={`badge ${STATUS_META[s.status].badge}`}>{STATUS_META[s.status].label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{new Date(s.created_at).toLocaleString("he-IL")}</span>
          {!editing && s.body != null && (
            <button className="text-slate-400 hover:text-brand-600 transition-colors p-1" title="ערוך" onClick={() => { setEditBody(s.body || ""); setEditing(true); }}>
              <Pencil size={15} />
            </button>
          )}
          <button className="text-slate-400 hover:text-rose-600 transition-colors p-1" title="מחק" onClick={onDelete}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea className="input" rows={3} value={editBody} onChange={(e) => setEditBody(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <button className="btn-primary text-sm py-1.5" onClick={saveEdit}><Check size={16} /> שמור</button>
            <button className="btn-secondary text-sm py-1.5" onClick={() => setEditing(false)}>ביטול</button>
          </div>
        </div>
      ) : (
        s.body && <div className="whitespace-pre-wrap text-slate-700">{s.body}</div>
      )}

      {/* Attachments */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {images.map((att) => (
            <ImageThumb key={att.path} att={att} onOpen={onOpenImage} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {others.map((att) => (
            <button
              key={att.path}
              onClick={() => openFile(att.path)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-slate-50 hover:text-brand-700 transition-colors"
            >
              <Download size={14} /> הורד · {att.name}
              {att.size > 0 && <span className="text-slate-400">({Math.round(att.size / 1024)} KB)</span>}
            </button>
          ))}
        </div>
      )}

      {/* Status selector */}
      <div className="flex items-center gap-1.5 mt-3">
        <span className="text-xs text-slate-400 ml-1">סטטוס:</span>
        {STATUS_ORDER.map((st) => (
          <button
            key={st}
            onClick={() => onSetStatus(s.id, st)}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              s.status === st
                ? STATUS_META[st].badge + " ring-1 ring-inset ring-current"
                : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            {STATUS_META[st].label}
          </button>
        ))}
      </div>

      {/* Comments thread */}
      <div className="mt-3 pt-3 border-t border-slate-100">
        {comments.length > 0 && (
          <ul className="space-y-2 mb-2">
            {comments.map((c) => (
              <CommentItem key={c.id} c={c} onEdit={onEditComment} onDelete={onDeleteComment} />
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <MessageSquare size={15} className="text-slate-300 shrink-0" />
          <input
            className="input py-1.5 text-sm flex-1"
            placeholder="הוסף תגובה..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitComment(); }}
          />
          <button className="btn-primary text-sm py-1.5 shrink-0" onClick={submitComment} disabled={!comment.trim()}>
            <Send size={15} /> שלח
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SuggestionsPage() {
  const qc = useQueryClient();

  const [author, setAuthor] = useState<Author>(
    () => (localStorage.getItem("suggestion-author") as Author) || "moshe",
  );
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const [filter, setFilter] = useState<SuggestionStatus | "all">("all");

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const { data: suggestions, isLoading } = useQuery({
    queryKey: ["suggestions"],
    queryFn: () => api.listSuggestions(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["suggestions"] });

  const create = useMutation({
    mutationFn: () => api.createSuggestion(author, body, files),
    onSuccess: () => {
      setBody("");
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      invalidate();
    },
  });

  const remove = useMutation({ mutationFn: (s: Suggestion) => api.deleteSuggestion(s), onSuccess: invalidate });
  const editBody = useMutation({ mutationFn: ({ id, body }: { id: number; body: string }) => api.updateSuggestion(id, body), onSuccess: invalidate });
  const status = useMutation({ mutationFn: ({ id, status }: { id: number; status: SuggestionStatus }) => api.setSuggestionStatus(id, status), onSuccess: invalidate });
  const addComment = useMutation({ mutationFn: ({ id, body }: { id: number; body: string }) => api.addSuggestionComment(id, author, body), onSuccess: invalidate });
  const editComment = useMutation({ mutationFn: ({ id, body }: { id: number; body: string }) => api.updateSuggestionComment(id, body), onSuccess: invalidate });
  const delComment = useMutation({ mutationFn: (id: number) => api.deleteSuggestionComment(id), onSuccess: invalidate });

  function chooseAuthor(a: Author) {
    setAuthor(a);
    localStorage.setItem("suggestion-author", a);
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setFiles(e.target.files ? Array.from(e.target.files) : []);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() && files.length === 0) return;
    create.mutate();
  }

  const canSubmit = (body.trim().length > 0 || files.length > 0) && !create.isPending;

  const all = suggestions || [];
  const counts = {
    all: all.length,
    open: all.filter((s) => s.status === "open").length,
    in_progress: all.filter((s) => s.status === "in_progress").length,
    done: all.filter((s) => s.status === "done").length,
  };
  const visible = filter === "all" ? all : all.filter((s) => s.status === filter);

  const FILTER_TABS: { key: SuggestionStatus | "all"; label: string; active: string }[] = [
    { key: "all", label: "הכל", active: "bg-brand-600 text-white" },
    { key: "open", label: "פתוח", active: "bg-slate-600 text-white" },
    { key: "in_progress", label: "בטיפול", active: "bg-amber-500 text-white" },
    { key: "done", label: "בוצע", active: "bg-emerald-600 text-white" },
  ];

  return (
    <div>
      <PageHeader
        title="הצעות ייעול"
        subtitle="רעיונות ושיפורים — טקסט, קבצים, תגובות וסטטוס טיפול"
      />

      {/* Author toggle */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-slate-700">אני כותב בתור:</span>
        <div className="flex gap-2">
          {(["moshe", "mordechai"] as Author[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => chooseAuthor(a)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                author === a
                  ? "bg-brand-600 text-white"
                  : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {AUTHOR_LABEL[a]}
            </button>
          ))}
        </div>
      </div>

      {/* Composer */}
      <div className="card mb-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <textarea
            className="input"
            rows={3}
            placeholder="כתוב הצעת ייעול..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="btn-secondary cursor-pointer">
              <Paperclip size={18} /> צרף קבצים
              <input ref={fileRef} type="file" multiple className="hidden" onChange={handleFiles} />
            </label>
            {files.length > 0 && (
              <span className="text-sm text-slate-500 truncate">
                {files.map((f) => f.name).join(", ")}
              </span>
            )}
            <button type="submit" className="btn-primary shrink-0 mr-auto" disabled={!canSubmit}>
              {create.isPending ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />} הוסף הצעה
            </button>
          </div>
        </form>
        {create.isError && (
          <div className="mt-3 bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700">
            שגיאה בשמירת ההצעה: {(create.error as any)?.message}
          </div>
        )}
      </div>

      {/* Feed + side status filter */}
      {isLoading ? (
        <Spinner />
      ) : all.length === 0 ? (
        <div className="card text-center py-12 text-slate-500">
          <Lightbulb size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-slate-700 font-medium mb-1">אין עדיין הצעות ייעול</p>
          <p className="text-sm">שתף רעיון או צרף קובץ כדי להתחיל.</p>
        </div>
      ) : (
        <div className="flex gap-6 items-start">
          {/* Side status filter */}
          <div className="w-36 shrink-0 sticky top-6 flex flex-col gap-1">
            <div className="text-xs text-slate-400 uppercase px-3 mb-1">סינון לפי סטטוס</div>
            {FILTER_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === t.key ? t.active : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span>{t.label}</span>
                <span className={`text-xs rounded-full px-1.5 py-0.5 ${filter === t.key ? "bg-white/25" : "bg-slate-100 text-slate-500"}`}>
                  {counts[t.key]}
                </span>
              </button>
            ))}
          </div>

          {/* Feed */}
          <div className="flex-1 min-w-0 space-y-4">
            {visible.length === 0 ? (
              <div className="card text-center py-10 text-slate-400 text-sm">אין הצעות בסטטוס הזה.</div>
            ) : (
              visible.map((s) => (
                <SuggestionCard
                  key={s.id}
                  s={s}
                  author={author}
                  onDelete={() => { if (confirm("למחוק את ההצעה?")) remove.mutate(s); }}
                  onOpenImage={(url, name) => setLightbox({ url, name })}
                  onUpdateBody={(id, b) => editBody.mutate({ id, body: b })}
                  onSetStatus={(id, st) => status.mutate({ id, status: st })}
                  onAddComment={(id, b) => addComment.mutate({ id, body: b })}
                  onEditComment={(id, b) => editComment.mutate({ id, body: b })}
                  onDeleteComment={(id) => delComment.mutate(id)}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* Image lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 left-4 text-white/80 hover:text-white p-1"
            title="סגור"
            onClick={() => setLightbox(null)}
          >
            <X size={28} />
          </button>
          <img
            src={lightbox.url}
            alt={lightbox.name}
            className="max-h-[90vh] max-w-[92vw] object-contain rounded shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
