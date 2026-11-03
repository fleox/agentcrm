import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { cn } from "../../shared/lib/utils";

// Renders user markdown (notes, activity bodies) sanitised by DOMPurify.
export function renderMarkdown(source: string): string {
  const html = marked.parse(source ?? "", { async: false, gfm: true, breaks: true }) as string;
  const purify = typeof window !== "undefined" ? DOMPurify : null;
  if (!purify || typeof purify.sanitize !== "function") return html.replace(/<script[\s\S]*?<\/script>/gi, "");
  return purify.sanitize(html, { USE_PROFILES: { html: true } });
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return (
    <div
      className={cn(
        "markdown break-words text-sm leading-relaxed text-surface-700 dark:text-surface-200",
        "[&_a]:text-accent-700 [&_a]:underline dark:[&_a]:text-accent-300 [&_blockquote]:border-l-2 [&_blockquote]:border-surface-200 [&_blockquote]:pl-3 [&_blockquote]:text-surface-500",
        "[&_code]:rounded [&_code]:bg-surface-100 [&_code]:px-1 [&_code]:text-[12px] dark:[&_code]:bg-surface-800 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-semibold",
        "[&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface-100 [&_pre]:p-2 dark:[&_pre]:bg-surface-800 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
