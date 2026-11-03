import { useEffect, useMemo, useRef, useState } from "react";
import { Marked, type Tokens } from "marked";
import DOMPurify from "dompurify";
import { cn } from "../../shared/lib/utils";
import { useFilesBridge } from "./files/context";
import { acquire, release } from "./files/fileUrls";
import { Lightbox } from "./files/Lightbox";

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FILE_RE = /^file:([A-Za-z0-9_-]{1,80})$/;

// Images: `![name](file:<id>)` → a stored file (resolved to a blob URL
// by <Markdown>), `https://` → as is; anything else (http:, data:,
// javascript:…) is dropped to its alt text.
const md = new Marked({ async: false, gfm: true, breaks: true });
md.use({
  renderer: {
    image({ href, text, title }: Tokens.Image): string {
      const alt = escapeAttr(text ?? "");
      const m = FILE_RE.exec(href ?? "");
      if (m) return `<img data-file-id="${m[1]}" alt="${alt}"${title ? ` title="${escapeAttr(title)}"` : ""} class="acrm-file-img" loading="lazy">`;
      if (/^https:\/\//i.test(href ?? "")) return `<img src="${escapeAttr(href)}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer">`;
      return alt;
    },
  },
});

// Raw <img> tags in the source: same rule (only https: survives).
function restrictImages(html: string): string {
  if (typeof document === "undefined" || !html.includes("<img")) return html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  for (const img of [...tpl.content.querySelectorAll("img")]) {
    const src = img.getAttribute("src");
    if (img.hasAttribute("data-file-id") ? !!src : !src || !/^https:\/\//i.test(src)) img.replaceWith(document.createTextNode(img.getAttribute("alt") ?? ""));
  }
  return tpl.innerHTML;
}

// Renders user markdown (notes, activity bodies) sanitised by DOMPurify.
export function renderMarkdown(source: string): string {
  const html = md.parse(source ?? "") as string;
  const purify = typeof window !== "undefined" ? DOMPurify : null;
  if (!purify || typeof purify.sanitize !== "function") return html.replace(/<script[\s\S]*?<\/script>/gi, "");
  return restrictImages(purify.sanitize(html, { USE_PROFILES: { html: true } }));
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  const ref = useRef<HTMLDivElement>(null);
  const bridge = useFilesBridge();
  const [open, setOpen] = useState<string | null>(null);
  const ids = useMemo(() => [...html.matchAll(/data-file-id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]), [html]);

  // Inline stored images: resolve each to its (cached) blob URL.
  useEffect(() => {
    const root = ref.current;
    if (!root || !ids.length) return;
    if (!bridge) {
      for (const img of root.querySelectorAll<HTMLImageElement>("img[data-file-id]")) img.replaceWith(document.createTextNode(img.alt));
      return;
    }
    let alive = true;
    const held: string[] = [];
    for (const img of root.querySelectorAll<HTMLImageElement>("img[data-file-id]")) {
      const id = img.dataset.fileId!;
      held.push(id);
      img.setAttribute("aria-busy", "true");
      const entry = acquire(bridge, id, false);
      entry.promise.then(
        (url) => {
          if (!alive) return;
          img.src = url;
          img.removeAttribute("aria-busy");
        },
        () => alive && img.setAttribute("data-error", "true"),
      );
    }
    return () => {
      alive = false;
      for (const id of held) release(bridge, id, false);
    };
  }, [html, ids, bridge]);

  const images = useMemo(() => (bridge ? ids.map((id) => bridge.meta(id)).filter((m): m is NonNullable<typeof m> => !!m) : []), [bridge, ids]);

  return (
    <>
      <div
        ref={ref}
        onClick={(e) => {
          const img = (e.target as HTMLElement).closest?.("img[data-file-id]") as HTMLImageElement | null;
          if (img?.dataset.fileId) {
            e.stopPropagation();
            setOpen(img.dataset.fileId);
          }
        }}
        className={cn(
          "markdown break-words text-sm leading-relaxed text-surface-700 dark:text-surface-200",
          "[&_a]:text-accent-700 [&_a]:underline dark:[&_a]:text-accent-300 [&_blockquote]:border-l-2 [&_blockquote]:border-surface-200 [&_blockquote]:pl-3 [&_blockquote]:text-surface-500",
          "[&_code]:rounded [&_code]:bg-surface-100 [&_code]:px-1 [&_code]:text-[12px] dark:[&_code]:bg-surface-800 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-semibold",
          "[&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface-100 [&_pre]:p-2 dark:[&_pre]:bg-surface-800 [&_ul]:list-disc [&_ul]:pl-5",
          "[&_img]:my-1.5 [&_img]:max-h-80 [&_img]:max-w-full [&_img]:rounded-md [&_img]:border [&_img]:border-surface-200 dark:[&_img]:border-surface-700",
          "[&_img[data-file-id]]:min-h-[48px] [&_img[data-file-id]]:min-w-[64px] [&_img[data-file-id]]:cursor-zoom-in [&_img[data-file-id]]:bg-surface-100 dark:[&_img[data-file-id]]:bg-surface-800",
          className,
        )}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {open && images.length > 0 && <Lightbox items={images} index={Math.max(0, images.findIndex((m) => m.id === open))} onClose={() => setOpen(null)} />}
    </>
  );
}
