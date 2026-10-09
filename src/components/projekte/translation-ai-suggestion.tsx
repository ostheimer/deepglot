"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type Action = "improve" | "rephrase" | "shorten";
type Preview = { fingerprint: string; provider: string; model: string | null;
  previewExpiresAt: string;
  inputCharacters: number; estimatedOutputCharacters: number; quotaWords: number;
  wordsUsed: number; wordsLimit: number; canRun: boolean;
  price: { currency: string; estimatedMaxMicros: string; unit: string;
    inputUnits: number; outputUnits: number } | null;
  budget: { allowed: boolean | null; previewOnly: boolean; code: string;
    platformCredits?: boolean; externalProviderCost?: boolean } };

function formatMicros(micros: string, locale: SiteLocale) {
  const value = BigInt(micros);
  const whole = value / BigInt(1_000_000);
  const fraction = (value % BigInt(1_000_000)).toString().padStart(6, "0");
  return `${whole}${locale === "de" ? "," : "."}${fraction}`;
}

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
      {preview.price ? <p>{uiText(locale, "Approved maximum cost ceiling", "Freigegebene Kostenobergrenze")}: {preview.price.currency} {formatMicros(preview.price.estimatedMaxMicros, locale)} · {preview.price.inputUnits} {uiText(locale, "input units", "Eingabeeinheiten")} / {preview.price.outputUnits} {uiText(locale, "maximum output units", "maximale Ausgabeeinheiten")} ({preview.price.unit})</p>
        : <p>{uiText(locale, "No approved provider price ceiling is available.", "Keine freigegebene Anbieter-Kostenobergrenze verfügbar.")} ({preview.budget.code})</p>}
      <p>{uiText(locale, "Plan words and provider costs are separate. No platform credits are included; the ceiling is not a provider invoice.",
        "Tarifwörter und Anbieterkosten sind getrennt. Plattform-Credits sind nicht enthalten; die Obergrenze ist keine Anbieterrechnung.")}</p>
      {preview.budget.previewOnly && <p>{uiText(locale,
        "Budget enforcement is inactive. This is a read-only estimate; AI Run is paused.",
        "Die Budgetdurchsetzung ist inaktiv. Dies ist nur eine Vorschau; KI-Ausführen ist pausiert.")}</p>}
      {!preview.budget.previewOnly && !preview.budget.allowed && <p>{uiText(locale,
        "The approved AI budget cannot admit this action. Review the provider and budget settings.",
        "Das freigegebene KI-Budget lässt diese Aktion nicht zu. Prüfe Anbieter und Budgeteinstellungen.")}</p>}
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
