/** Build a script-free page preview from public HTML, keeping same-project assets. */
export function sandboxHtml(html: string, pageUrl: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const origin = new URL(pageUrl).origin;
  doc.querySelectorAll("script, iframe, frame, object, embed, form, meta[http-equiv], base").forEach((node) => node.remove());
  const csp = doc.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = `default-src 'none'; img-src ${origin} data:; style-src ${origin} 'unsafe-inline'; font-src ${origin} data:; base-uri ${origin}; form-action 'none'`;
  doc.head.prepend(csp);
  const base = doc.createElement("base");
  base.href = pageUrl;
  doc.head.insertBefore(base, csp.nextSibling);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
