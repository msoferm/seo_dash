import { Loader2 } from "lucide-react";

export default function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 text-slate-500 py-8">
      <Loader2 className="animate-spin" size={18} />
      <span>{label || "טוען..."}</span>
    </div>
  );
}
