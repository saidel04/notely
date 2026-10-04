import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * Markdown → sanitized HTML. Canvas and note text can come from agents or
 * other apps, so nothing that could run script is ever let through.
 */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { gfm: true, breaks: true, async: false }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input"] });
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
