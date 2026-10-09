"use client";

import { useRef, useState } from "react";
import { MousePointer2 } from "lucide-react";
import { toast } from "sonner";

import { useLocale } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chooseVisualSelector, type VisualSelection } from "@/lib/exclusion-visual-selector";
import { uiText } from "@/lib/static-copy";

type Exclusion = { id: string; type: "CSS_CLASS" | "CSS_ID"; value: string; createdAt: string };

function sandboxHtml(html: string, pageUrl: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const origin = new URL(pageUrl).origin;
  doc.querySelectorAll("script, iframe, frame, object, embed, form, meta[http-equiv], base").forEach((node) => node.remove());
  const csp = doc.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = `default-src 'none'; img-src ${origin} data:; style-src ${origin} 'unsafe-inline'; font-src ${origin} data:; base-uri ${origin}; form-action 'none'`;
  doc.head.prepend(csp);
  // Keep relative images/styles from the real project page. Scripts and forms stay disabled.
  const base = doc.createElement("base");
  base.href = pageUrl;
  doc.head.insertBefore(base, csp.nextSibling);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export function VisualExclusionBuilder({ projectId, onSaved }: { projectId: string; onSaved: (rule: Exclusion) => void }) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("/");
  const [html, setHtml] = useState("");
  const [selection, setSelection] = useState<VisualSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const highlight = useRef<HTMLElement | null>(null);

  const t = (en: string, de: string) => uiText(locale, en, de);

  async function loadPage() {
    setBusy(true);
    setHtml("");
    setSelection(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/exclusions/visual-preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }),
      });
      const result = await response.json() as { html?: string; url?: string; error?: string };
      if (!response.ok || !result.html || !result.url) throw new Error(result.error || t("Could not load page", "Seite konnte nicht geladen werden"));
      setHtml(sandboxHtml(result.html, result.url));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Could not load page", "Seite konnte nicht geladen werden"));
    } finally { setBusy(false); }
  }

  function onFrameLoad() {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    doc.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (highlight.current) highlight.current.style.outline = "";
      const target = event.target;
      // The iframe has its own JS realm, so instanceof Element in the parent is false.
      if (!target || (target as Node).nodeType !== 1) return;
      const candidate = chooseVisualSelector(target as Element, doc);
      if (!candidate) {
        setSelection(null);
        toast.error(t("This element has no unique, stable ID or class. Choose a more specific element.", "Dieses Element hat keine eindeutige, stabile ID oder Klasse. Wähle ein genaueres Element."));
        return;
      }
      const element = target as HTMLElement;
      element.style.outline = "3px solid #e65c00";
      highlight.current = element;
      setSelection(candidate);
    }, true);
  }

  async function save() {
    if (!selection) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/exclusions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: selection.type, value: selection.value }),
      });
      const result = await response.json() as { exclusion?: Exclusion; error?: string };
      if (!response.ok || !result.exclusion) throw new Error(result.error || t("Could not save rule", "Regel konnte nicht gespeichert werden"));
      onSaved(result.exclusion);
      setOpen(false);
      toast.success(t("Exclusion rule saved", "Ausnahmeregel gespeichert"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Could not save rule", "Regel konnte nicht gespeichert werden"));
    } finally { setBusy(false); }
  }

  return <>
    <Button type="button" variant="outline" onClick={() => setOpen(true)}><MousePointer2 className="mr-2 h-4 w-4" />{t("Select on page", "Auf Seite auswählen")}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[95vh] max-w-[min(96vw,1100px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Visual exclusion", "Visuelle Ausnahme")}</DialogTitle>
          <DialogDescription>{t("Load a public project page, then click an element. Only a unique, stable ID or class can be saved. The rule applies across the project wherever that ID or class occurs.", "Lade eine öffentliche Projektseite und klicke auf ein Element. Gespeichert werden nur eindeutige, stabile IDs oder Klassen. Die Regel gilt im ganzen Projekt, wo diese ID oder Klasse vorkommt.")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-2">
          <div className="grow space-y-2"><Label htmlFor="visual-exclusion-path">{t("Project page path", "Pfad der Projektseite")}</Label><Input id="visual-exclusion-path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/" /></div>
          <Button type="button" disabled={busy} onClick={() => void loadPage()}>{t("Load page", "Seite laden")}</Button>
        </div>
        {html && <iframe ref={frame} title={t("Page preview for element selection", "Seitenvorschau zur Elementauswahl")} srcDoc={html} sandbox="allow-same-origin" onLoad={onFrameLoad} className="h-[min(55vh,600px)] w-full rounded border bg-white" />}
        {selection && <div className="rounded border bg-gray-50 p-3 text-sm">
          <p>{t("Generated selector", "Erzeugter Selektor")}: <code className="font-mono">{selection.selector}</code></p>
          <p>{t("Matches on this page", "Treffer auf dieser Seite")}: {selection.count}</p>
          <p>{t("Rule scope: all pages of this project after the next WordPress sync", "Geltungsbereich: alle Seiten dieses Projekts nach dem nächsten WordPress-Sync")}</p>
        </div>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("Cancel", "Abbrechen")}</Button><Button type="button" disabled={!selection || busy} onClick={() => void save()}>{t("Save exclusion", "Ausnahme speichern")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
