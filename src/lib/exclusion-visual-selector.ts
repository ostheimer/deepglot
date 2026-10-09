import type { ExclusionType } from "@/lib/exclusions";

/** Literal single-token selectors are the exact grammar supported by the WordPress runtime. */
export function stableVisualToken(token: string): boolean {
  return token.length >= 4 && token.length <= 80
    && /^[\p{L}_][\p{L}\p{N}_-]*$/u.test(token)
    && !/^(?:html|body|main|header|footer|active|current|selected|open|hidden|container|wrapper|row|col|button|content|widget|block|element|section|title|text|menu|nav)$/iu.test(token)
    && !/(?:^|[-_])(?:js|css|hover|focus|active|open|current|selected|loading|random|nonce|session)(?:$|[-_])/iu.test(token)
    && !/[a-f0-9]{10,}/iu.test(token)
    && !/^(?:wp-block|elementor|fusion|e-con|ast-|et_pb|vc_)/iu.test(token);
}

export type VisualSelection = { type: Extract<ExclusionType, "CSS_ID" | "CSS_CLASS">; value: string; selector: string; count: number };

export function chooseVisualSelector(element: Element, document: Document): VisualSelection | null {
  if (element === document.body || element === document.documentElement || ["SCRIPT", "STYLE", "HEAD", "META", "LINK", "IFRAME", "FORM", "MAIN", "HEADER", "FOOTER", "NAV"].includes(element.tagName)) return null;
  const descendants = element.querySelectorAll("*").length;
  const textLength = (element.textContent?.trim() ?? "").length;
  const bodyTextLength = (document.body?.textContent?.trim() ?? "").length;
  if (descendants > 100 || textLength > 3000 || (descendants >= 2 && bodyTextLength > 0 && textLength / bodyTextLength > 0.5)) return null;
  const candidates: Array<{ type: VisualSelection["type"]; value: string; selector: string }> = [];
  if (stableVisualToken(element.id)) candidates.push({ type: "CSS_ID", value: element.id, selector: `#${CSS.escape(element.id)}` });
  for (const name of element.classList) {
    if (stableVisualToken(name)) candidates.push({ type: "CSS_CLASS", value: name, selector: `.${CSS.escape(name)}` });
  }
  for (const candidate of candidates) {
    const count = document.querySelectorAll(candidate.selector).length;
    if (count === 1) return { ...candidate, count };
  }
  return null;
}
