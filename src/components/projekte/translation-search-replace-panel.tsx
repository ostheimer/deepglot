"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";
import { REPORTED_TYPE_GROUPS } from "@/lib/translation-reported-types";

type SelectedSegment = {
  id: string; updatedAt: string; isManual: boolean; status: string;
  typeObservations?: { wordType: number }[];
};

export function TranslationSearchReplacePanel({ projectId, locale, selected, onApplied }: {
  projectId: string; locale: SiteLocale; selected: SelectedSegment[];
  onApplied: () => Promise<void>;
}) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [includeReviewed, setIncludeReviewed] = useState(false);
  const [preview, setPreview] = useState<{
    fingerprint: string; selectionKey: string; find: string; replace: string; includeReviewed: boolean;
    items: { id: string; before: string; after: string; reviewed: boolean; statusAfter: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selectionKey = selected.map((item) => `${item.id}:${item.updatedAt}`).join("|");
  const eligible = selected.length > 0 && selected.length <= 100 && selected.every((item) =>
    (includeReviewed || (!item.isManual && item.status !== "approved")) && item.typeObservations?.length &&
    item.typeObservations.every((type) => REPORTED_TYPE_GROUPS.text.includes(type.wordType as never)));
  const currentPreview = preview?.selectionKey === selectionKey && preview.find === find &&
    preview.replace === replace && preview.includeReviewed === includeReviewed ? preview : null;

  async function submit(mode: "preview" | "apply") {
    if (!eligible || !find || (mode === "apply" && !currentPreview)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/translations/search-replace`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, find, replace, includeReviewed,
          items: selected.map((item) => ({ id: item.id, expectedUpdatedAt: item.updatedAt })),
          ...(mode === "apply" ? { fingerprint: currentPreview?.fingerprint } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Request failed");
      if (mode === "preview") setPreview({ ...body, selectionKey, find, replace, includeReviewed });
      else {
        setPreview(null);
        setMessage(uiText(locale, "Selected replacements were saved.", "Die ausgewählten Ersetzungen wurden gespeichert."));
        await onApplied();
      }
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "Request failed");
      if (mode === "apply") await onApplied();
    } finally { setBusy(false); }
  }

  return <div className="space-y-3 border-b border-gray-200 bg-slate-50 px-5 py-4 text-sm">
    <h3 className="font-medium">{uiText(locale, "Search and replace selected text", "Ausgewählten Text suchen und ersetzen")}</h3>
    <p className="text-gray-600">{uiText(locale,
      "Select up to 100 reported text segments. Media and external links are excluded. Preview before saving all changes together.",
      "Wähle bis zu 100 gemeldete Textsegmente. Medien und externe Links sind ausgeschlossen. Prüfe die Vorschau, bevor alle Änderungen gemeinsam gespeichert werden.")}</p>
    <label className="flex items-center gap-2"><input type="checkbox" checked={includeReviewed}
      onChange={(event) => { setIncludeReviewed(event.target.checked); setPreview(null); }} />
      {uiText(locale, "Include selected manual and approved text; edits reset review status",
        "Ausgewählte manuelle und freigegebene Texte einbeziehen; Änderungen setzen den Prüfstatus zurück")}</label>
    <div className="flex flex-wrap gap-2">
      <Input className="max-w-56" value={find} maxLength={200} aria-label={uiText(locale, "Find literal text", "Wörtlichen Text suchen")}
        onChange={(event) => { setFind(event.target.value); setPreview(null); }} />
      <Input className="max-w-56" value={replace} maxLength={200} aria-label={uiText(locale, "Replace with", "Ersetzen durch")}
        onChange={(event) => { setReplace(event.target.value); setPreview(null); }} />
      <Button type="button" size="sm" variant="outline" disabled={!eligible || !find || busy}
        onClick={() => void submit("preview")}>{uiText(locale, "Preview replacements", "Ersetzungen vorab prüfen")}</Button>
      <Button type="button" size="sm" disabled={!currentPreview || busy}
        onClick={() => void submit("apply")}>{uiText(locale, "Save previewed replacements", "Geprüfte Ersetzungen speichern")}</Button>
    </div>
    {selected.length > 0 && !eligible && <p className="text-amber-800">{uiText(locale,
      "Select reported text only; include reviewed text explicitly if needed.",
      "Wähle nur gemeldeten Text; beziehe geprüfte Texte bei Bedarf ausdrücklich ein.")}</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {message && <p role="status" className="text-emerald-700">{message}</p>}
    {currentPreview && <div className="max-h-72 space-y-2 overflow-auto" aria-label={uiText(locale, "Replacement preview", "Ersetzungsvorschau")}>
      {currentPreview.items.map((item) => <div key={item.id} className="rounded border bg-white p-2">
        <p className="break-all text-gray-600">{item.before}</p>
        <p className="break-all font-medium">→ {item.after}</p>
        {item.reviewed && <p className="text-amber-800">{uiText(locale,
          "Reviewed text: saving resets status to", "Geprüfter Text: Speichern setzt den Status zurück auf")} {item.statusAfter}</p>}
      </div>)}
    </div>}
  </div>;
}
