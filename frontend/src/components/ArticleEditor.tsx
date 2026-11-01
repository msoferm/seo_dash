import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Bold, Italic, Heading2, Heading3, List, Link2, Pilcrow } from "lucide-react";
import type { InternalLink } from "../api";

export interface ArticleEditorHandle {
  getHtml: () => string;
  insertLinks: (links: InternalLink[]) => void;
}

/**
 * Lightweight WYSIWYG editor for the blog article body (#2b): the user edits the text as it
 * looks on screen — no HTML code. Uncontrolled contentEditable so typing never fights React;
 * the parent reads the HTML on demand via the ref.
 */
const ArticleEditor = forwardRef<ArticleEditorHandle, { initialHtml: string }>(({ initialHtml }, ref) => {
  const elRef = useRef<HTMLDivElement>(null);

  // Load the generated article once (and whenever a NEW sample replaces it). Typing afterwards
  // does not change `initialHtml`, so edits are preserved across re-renders.
  useEffect(() => { if (elRef.current) elRef.current.innerHTML = initialHtml || ""; }, [initialHtml]);

  useImperativeHandle(ref, () => ({
    getHtml: () => elRef.current?.innerHTML || "",
    insertLinks: (links: InternalLink[]) => {
      const el = elRef.current; if (!el) return;
      let html = el.innerHTML;
      const extra: InternalLink[] = [];
      for (const l of links) {
        if (!l.url || html.includes(`href="${l.url}"`)) continue; // skip already-linked
        const a = (l.anchor || "").trim();
        if (a && !/[<>"]/.test(a) && html.includes(a)) {
          html = html.replace(a, `<a href="${l.url}">${a}</a>`); // first natural occurrence
        } else {
          extra.push(l);
        }
      }
      if (extra.length) {
        html += `<h3>קישורים רלוונטיים</h3><ul>${extra.map((l) => `<li><a href="${l.url}">${(l.anchor && l.anchor.trim()) || l.url}</a></li>`).join("")}</ul>`;
      }
      el.innerHTML = html;
    },
  }));

  const cmd = (c: string, v?: string) => { document.execCommand(c, false, v); elRef.current?.focus(); };
  const Btn = ({ onDo, title, children }: { onDo: () => void; title: string; children: React.ReactNode }) => (
    <button type="button" title={title} className="btn-secondary text-xs py-1 px-2" onMouseDown={(e) => { e.preventDefault(); onDo(); }}>{children}</button>
  );

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-2">
        <Btn title="מודגש" onDo={() => cmd("bold")}><Bold size={14} /></Btn>
        <Btn title="נטוי" onDo={() => cmd("italic")}><Italic size={14} /></Btn>
        <Btn title="כותרת משנה (H2)" onDo={() => cmd("formatBlock", "<h2>")}><Heading2 size={14} /></Btn>
        <Btn title="כותרת קטנה (H3)" onDo={() => cmd("formatBlock", "<h3>")}><Heading3 size={14} /></Btn>
        <Btn title="פסקה רגילה" onDo={() => cmd("formatBlock", "<p>")}><Pilcrow size={14} /></Btn>
        <Btn title="רשימה" onDo={() => cmd("insertUnorderedList")}><List size={14} /></Btn>
        <Btn title="הפוך לקישור" onDo={() => { const url = prompt("כתובת הקישור (URL):"); if (url) cmd("createLink", url); }}><Link2 size={14} /></Btn>
      </div>
      <div
        ref={elRef}
        contentEditable
        dir="rtl"
        suppressContentEditableWarning
        className="prose prose-sm prose-slate max-w-none min-h-[280px] max-h-[520px] overflow-y-auto border border-slate-200 rounded-lg p-3 text-slate-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-200 [&_h2]:font-bold [&_h2]:text-base [&_h2]:mt-3 [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pr-5 [&_p]:my-2 [&_a]:text-brand-600 [&_a]:underline"
      />
    </div>
  );
});

export default ArticleEditor;
