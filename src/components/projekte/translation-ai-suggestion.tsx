"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type Action = "improve" | "rephrase" | "shorten";
type Preview = { fingerprint: string; provider: string; model: string | null;
  previewExpiresAt: string;
  inputCharacters: number; estimatedOutputCharacters: number; quotaWords: number;
  wordsUsed: number; wordsLimit: number; canRun: boolean; price: null };

export function TranslationAiSuggestion({ projectId, translationId, expectedUpdatedAt, locale, onUse }: {
  projectId: string; translationId: string; expectedUpdatedAt: string; locale: SiteLocale;
  onUse: (suggestion: string) => void;
}) {
  const [action, setAction] = useState<Action>("improve");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function request(mode: "preview" | "run") {
    if (mode === "run" && (!preview || !preview.canRun)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/translations/${translationId}/ai-suggestion`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, action, expectedUpdatedAt,
          ...(mode === "run" ? { fingerprint: preview?.fingerprint,
            previewExpiresAt: preview?.previewExpiresAt } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Request failed");
      if (mode === "preview") { setPreview(body); setSuggestion(null); }
      else { setSuggestion(body.suggestion); setPreview(null); }
    } catch (caught) {
      setPreview(null); setSuggestion(null);
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally { setBusy(false); }
  }
  return <div className="space-y-2 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <select value={action} aria-label={uiText(locale, "AI editing action", "KI-Bearbeitungsaktion")}
        onChange={(event) => { setAction(event.target.value as Action); setPreview(null); setSuggestion(null); }}
        className="h-8 rounded border bg-white px-2">
        <option value="improve">{uiText(locale, "Improve with AI", "Mit KI verbessern")}</option>
        <option value="rephrase">{uiText(locale, "Rephrase with AI", "Mit KI umformulieren")}</option>
        <option value="shorten">{uiText(locale, "Shorten with AI", "Mit KI kürzen")}</option>
      </select>
      <Button type="button" size="xs" variant="outline" disabled={busy}
        onClick={() => void request("preview")}>{uiText(locale, "Check provider and quota", "Anbieter und Kontingent prüfen")}</Button>
    </div>
    {preview && <div className="space-y-1 text-gray-700">
      <p>{preview.provider}{preview.model ? ` · ${preview.model}` : ""} · {preview.inputCharacters} {uiText(locale, "input characters", "Eingabezeichen")} · {preview.estimatedOutputCharacters} {uiText(locale, "estimated output characters", "geschätzte Ausgabezeichen")}</p>
      <p>{uiText(locale, "Estimated quota words", "Geschätzte Kontingentwörter")}: {preview.quotaWords} · {uiText(locale, "Used / limit", "Verbraucht / Limit")}: {preview.wordsUsed} / {preview.wordsLimit}</p>
      <p>{uiText(locale, "Exact provider price is unavailable; running may incur provider charges and count against quota.",
        "Ein genauer Anbieterpreis ist nicht verfügbar; Ausführen kann Anbieterkosten verursachen und das Kontingent belasten.")}</p>
      <Button type="button" size="xs" disabled={busy || !preview.canRun}
        onClick={() => void request("run")}>{uiText(locale, "Run AI now", "KI jetzt ausführen")}</Button>
    </div>}
    {suggestion !== null && <div className="space-y-2">
      <p className="whitespace-pre-wrap break-words rounded bg-white p-2">{suggestion}</p>
      <Button type="button" size="xs" variant="outline" onClick={() => { onUse(suggestion); setSuggestion(null); }}>
        {uiText(locale, "Use suggestion in editor", "Vorschlag im Editor verwenden")}</Button>
      <p className="text-gray-600">{uiText(locale, "The translation changes only after you save the editor.",
        "Die Übersetzung ändert sich erst, wenn du den Editor speicherst.")}</p>
    </div>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </div>;
}
