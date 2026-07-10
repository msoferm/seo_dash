import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Paperclip, Download, Trash2, Plus, Loader2, X } from "lucide-react";
import * as api from "../api";
import type { Suggestion, SuggestionAttachment } from "../api";
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

function SuggestionCard({ s, onDelete, onOpenImage }: {
  s: Suggestion;
  onDelete: () => void;
  onOpenImage: (url: string, name: string) => void;
}) {
  async function openFile(path: string) {
    const url = await api.suggestionFileUrl(path);
    window.open(url, "_blank");
  }

  const images = (s.attachments || []).filter(isImage);
  const others = (s.attachments || []).filter((a) => !isImage(a));

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <span className={`badge ${AUTHOR_BADGE[s.author]}`}>{AUTHOR_LABEL[s.author]}</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            {new Date(s.created_at).toLocaleString("he-IL")}
          </span>
          <button
            className="text-slate-400 hover:text-rose-600 transition-colors p-1"
            title="מחק"
            onClick={onDelete}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {s.body && <div className="whitespace-pre-wrap text-slate-700">{s.body}</div>}

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

  const remove = useMutation({
    mutationFn: (s: Suggestion) => api.deleteSuggestion(s),
    onSuccess: invalidate,
  });

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

  return (
    <div>
      <PageHeader
        title="הצעות ייעול"
        subtitle="רעיונות ושיפורים — טקסט וקבצים, לפי כותב"
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

      {/* Feed */}
      {isLoading ? (
        <Spinner />
      ) : (suggestions || []).length === 0 ? (
        <div className="card text-center py-12 text-slate-500">
          <Lightbulb size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-slate-700 font-medium mb-1">אין עדיין הצעות ייעול</p>
          <p className="text-sm">שתף רעיון או צרף קובץ כדי להתחיל.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {(suggestions || []).map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              onDelete={() => remove.mutate(s)}
              onOpenImage={(url, name) => setLightbox({ url, name })}
            />
          ))}
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
