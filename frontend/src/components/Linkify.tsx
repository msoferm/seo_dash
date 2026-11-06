import { Fragment } from "react";
import { ExternalLink } from "lucide-react";

const URL_RE = /(https?:\/\/[^\s<>"'()]+)/g;

function decodePath(u: string): string {
  try { return decodeURIComponent(u.replace(/^https?:\/\/[^/]+/, "")) || u; } catch { return u; }
}

/** Render text with every raw URL replaced by a short "מעבר לעמוד" link (full decoded path in the tooltip). */
export default function Linkify({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        // keep trailing punctuation outside the link
        const m = part.match(/^(.*?)([.,;:!?]*)$/);
        const url = m ? m[1] : part;
        const tail = m ? m[2] : "";
        return (
          <Fragment key={i}>
            <a href={url} target="_blank" rel="noreferrer" title={decodePath(url)} className="text-sky-700 hover:underline inline-flex items-center gap-0.5 font-medium">
              <ExternalLink size={11} /> מעבר לעמוד
            </a>{tail}
          </Fragment>
        );
      })}
    </>
  );
}
