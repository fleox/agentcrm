// Markdown rendering for assistant answers: marked → DOMPurify, external
// links open in a new tab (in-app `#/…` links stay in the admin).

import { marked } from "marked";
import DOMPurify from "dompurify";

export function renderAssistantMarkdown(source: string): string {
  const html = marked.parse(source ?? "", { async: false, gfm: true, breaks: true }) as string;
  if (typeof window === "undefined" || typeof DOMPurify.sanitize !== "function") return html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  const tpl = document.createElement("template");
  tpl.innerHTML = clean;
  tpl.content.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      a.removeAttribute("target");
      return;
    }
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
  return tpl.innerHTML;
}
