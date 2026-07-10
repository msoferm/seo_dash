import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Upload, Plus, Trash2, ListTodo, CheckCircle2, Loader2 } from "lucide-react";
import * as api from "../api";
import type { Task } from "../api";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";

const SOURCE_LABEL: Record<Task["source"], string> = {
  claude: "קלוד",
  upload: "קובץ",
  manual: "ידני",
};

const SOURCE_BADGE: Record<Task["source"], string> = {
  claude: "bg-brand-50 text-brand-700",
  upload: "bg-amber-50 text-amber-700",
  manual: "bg-slate-100 text-slate-600",
};

const PRIORITY_LABEL: Record<NonNullable<Task["priority"]>, string> = {
  high: "גבוהה",
  medium: "בינונית",
  low: "נמוכה",
};

const PRIORITY_BADGE: Record<NonNullable<Task["priority"]>, string> = {
  high: "bg-rose-50 text-rose-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-emerald-50 text-emerald-700",
};

function TaskRow({ task, onToggle, onDelete }: { task: Task; onToggle: (done: boolean) => void; onDelete: () => void }) {
  const done = task.status === "done";
  return (
    <li className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0">
      <input
        type="checkbox"
        checked={done}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-brand-600 cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <div className={`font-medium ${done ? "line-through text-slate-400" : "text-slate-900"}`}>{task.title}</div>
        {task.details && <div className="text-xs text-slate-500 mt-0.5">{task.details}</div>}
        <div className="flex gap-1.5 mt-1.5">
          <span className={`badge ${SOURCE_BADGE[task.source]}`}>{SOURCE_LABEL[task.source]}</span>
          {task.priority && <span className={`badge ${PRIORITY_BADGE[task.priority]}`}>{PRIORITY_LABEL[task.priority]}</span>}
        </div>
      </div>
      <button
        className="text-slate-400 hover:text-rose-600 transition-colors shrink-0 p-1"
        title="מחק"
        onClick={onDelete}
      >
        <Trash2 size={16} />
      </button>
    </li>
  );
}

export default function TasksPage() {
  const { clientId } = useParams();
  const cid = Number(clientId);
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks", cid],
    queryFn: () => api.listTasks(cid),
    enabled: !!cid,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["tasks", cid] });

  const suggest = useMutation({
    mutationFn: () => api.suggestTasks(cid),
    onSuccess: invalidate,
  });

  const upload = useMutation({
    mutationFn: (titles: string[]) => api.bulkCreateTasks(cid, titles),
    onSuccess: invalidate,
  });

  const create = useMutation({
    mutationFn: (title: string) => api.createTask(cid, title),
    onSuccess: () => {
      setNewTitle("");
      invalidate();
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) => api.setTaskDone(id, done),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteTask(id),
    onSuccess: invalidate,
  });

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const titles = text
      .split(/\r?\n/)
      .map((line) => line.split(",")[0].trim())
      .filter((t) => t.length > 0);
    if (titles.length > 0) upload.mutate(titles);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (title) create.mutate(title);
  }

  const openTasks = (tasks || []).filter((t) => t.status === "open");
  const doneTasks = (tasks || []).filter((t) => t.status === "done");

  return (
    <div>
      <PageHeader
        title="לוח משימות"
        subtitle="משימות SEO ללקוח — מקלוד, מהעלאת קובץ, או ידני"
        actions={
          <>
            <button className="btn-primary" onClick={() => suggest.mutate()} disabled={suggest.isPending}>
              {suggest.isPending ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} קבל משימות מקלוד
            </button>
            <label className="btn-secondary cursor-pointer">
              <Upload size={18} /> העלה קובץ משימות
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.csv"
                className="hidden"
                onChange={handleFile}
              />
            </label>
          </>
        }
      />

      {suggest.isError && (
        <div className="mb-4 bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700">
          שגיאה בקבלת משימות מקלוד: {(suggest.error as any)?.message}
        </div>
      )}
      {suggest.isSuccess && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">
          קלוד יצר {(suggest.data as any).created} משימות חדשות.
        </div>
      )}
      {upload.isError && (
        <div className="mb-4 bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700">
          שגיאה בהעלאת הקובץ: {(upload.error as any)?.message}
        </div>
      )}
      {upload.isSuccess && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">
          נוספו {upload.data} משימות מהקובץ.
        </div>
      )}

      <div className="card mb-6">
        <form className="flex gap-2" onSubmit={handleAdd}>
          <input
            className="input flex-1"
            placeholder="הוסף משימה חדשה..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <button type="submit" className="btn-primary shrink-0" disabled={create.isPending || !newTitle.trim()}>
            <Plus size={18} /> הוסף
          </button>
        </form>
      </div>

      {isLoading ? (
        <Spinner />
      ) : (tasks || []).length === 0 ? (
        <div className="card text-center py-12 text-slate-500">
          <ListTodo size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-slate-700 font-medium mb-1">אין עדיין משימות</p>
          <p className="text-sm">הוסף משימה ידנית, העלה קובץ משימות, או בקש מקלוד הצעות.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="card">
            <h3 className="font-semibold mb-2 flex items-center gap-2"><ListTodo size={18} /> פתוחות <span className="text-slate-500 text-sm font-normal">({openTasks.length})</span></h3>
            {openTasks.length === 0 ? (
              <p className="text-slate-500 text-sm py-2">אין משימות פתוחות. כל הכבוד!</p>
            ) : (
              <ul>
                {openTasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={(done) => toggle.mutate({ id: t.id, done })}
                    onDelete={() => remove.mutate(t.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          {doneTasks.length > 0 && (
            <div className="card opacity-70">
              <h3 className="font-semibold mb-2 flex items-center gap-2 text-slate-400"><CheckCircle2 size={18} /> הושלמו <span className="text-slate-500 text-sm font-normal">({doneTasks.length})</span></h3>
              <ul>
                {doneTasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={(done) => toggle.mutate({ id: t.id, done })}
                    onDelete={() => remove.mutate(t.id)}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
