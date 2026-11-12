import { createContext, Fragment, useContext, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";

/** Lets AI text turn page paths ("/matrix/…") into links labeled with the page title. */
export const PageLinkContext = createContext<{ base: string; titleOf: (path: string) => string | null }>({ base: "", titleOf: () => null });

function decodePath(u: string): string {
  try { return decodeURIComponent(u.replace(/^https?:\/\/[^/]+/, "")) || u; } catch { return u; }
}
/** Normalized decoded path, used to look pages up by what the AI wrote. */
export const pathKey = (u: string) => decodePath(u).replace(/\/+$/, "").toLowerCase();

// **bold** | full URL | site path (starts with "/" and is not part of a word or a fraction).
const TOKEN = /(\*\*[^*]+\*\*|https?:\/\/[^\s<>"]+|(?<![\p{L}\p{N}/])\/[^\s<>"،,;]{2,})/gu;
const TRAIL = /[.,:;!?)\]»”'"]+$/;

function PageLink({ raw }: { raw: string }) {
  const { base, titleOf } = useContext(PageLinkContext);
  const tail = raw.match(TRAIL)?.[0] || "";
  const ref = tail ? raw.slice(0, -tail.length) : raw;
  const isUrl = /^https?:\/\//.test(ref);
  if (!isUrl && !base) return <>{raw}</>;
  const href = isUrl ? ref : base.replace(/\/+$/, "") + encodeURI(ref);
  const title = titleOf(ref);
  return (
    <>
      <a href={href} target="_blank" rel="noreferrer" title={decodePath(ref)} className="text-sky-700 hover:underline inline-flex items-center gap-0.5 font-medium">
        <ExternalLink size={11} className="shrink-0" />{title || decodePath(ref)}
      </a>{tail}
    </>
  );
}

export function inline(text: string): ReactNode {
  return text.split(TOKEN).map((p, i) => {
    if (!p) return null;
    if (p.startsWith("**") && p.endsWith("**")) return <b key={i}>{inline(p.slice(2, -2))}</b>;
    if (/^https?:\/\//.test(p) || /^\/[^\s]{2,}/.test(p)) return <PageLink key={i} raw={p} />;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

/** Markdown-ish renderer for AI text: headings, bullet/numbered lists, tables, bold, page links. */
export function Md({ text, className = "" }: { text: string; className?: string }) {
  const lines = String(text || "").split("\n");
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
          <table className="text-xs border border-slate-200 min-w-[50%]">
            <tbody>{tbl.map((r, ri) => <tr key={ri} className={ri === 0 ? "bg-slate-100 font-semibold" : "border-t border-slate-100"}>{r.map((c, ci) => <td key={ci} className="px-2 py-1 align-top">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { out.push(<div key={i} className={`font-semibold text-slate-900 ${h[1].length <= 2 ? "text-[15px] mt-3" : "mt-2"} mb-1`}>{inline(h[2])}</div>); continue; }
    const b = l.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)/);
    if (b) {
      out.push(<div key={i} className="flex gap-1.5 my-0.5" style={{ paddingRight: b[1].length * 6 }}><span className="text-slate-400 shrink-0">{/\d/.test(b[2]) ? b[2] : "•"}</span><span>{inline(b[3])}</span></div>);
      continue;
    }
    if (/^\s*---+\s*$/.test(l)) { out.push(<hr key={i} className="my-2 border-slate-200" />); continue; }
    out.push(l.trim() ? <div key={i} className="my-0.5">{inline(l)}</div> : <div key={i} className="h-2" />);
  }
  return <div className={`text-sm leading-relaxed text-slate-800 ${className}`}>{out}</div>;
}
