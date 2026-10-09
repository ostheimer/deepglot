"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SiteLocale } from "@/lib/site-locale";
import { localizeCopy } from "@/lib/static-copy";
import type { TranslationProviderName } from "@/lib/translation-types";

type ProviderOption = {
  id: TranslationProviderName;
  label: string;
  recommendedModels: string[];
};

type LanguageModelSettings = {
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
  hasProjectApiKey: boolean;
  providerReconnectRequired?: boolean;
  websiteDescription?: string | null;
  translationTone?: string | null;
  translationAudience?: string | null;
  translationInstructions?: string | null;
  useGlossaryAsContext?: boolean;
  useApprovedTranslationsAsContext?: boolean;
};

type EffectiveSettings = {
  provider: TranslationProviderName;
  providerLabel: string;
  model: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
};

const COPY = {
  en: {
    title: "Translation provider",
    description:
      "Choose the provider and model used for uncached automatic translations. Project settings override workspace environment defaults.",
    workspaceDefault: "Workspace default",
    provider: "Provider",
    model: "Model",
    modelHint: "Pick a preset or enter any provider-specific model id.",
    baseUrl: "Base URL",
    apiKey: "API key",
    apiKeyPlaceholder: "Leave blank to keep the existing or workspace key",
    clearApiKey: "Clear stored project API key",
    save: "Save settings",
    saving: "Saving...",
    saved: "Language model settings saved.",
    failed: "Could not save language model settings.",
    contextTitle: "Translation context",
    websiteDescription: "Website description",
    suggestDescription: "Suggest from project details",
    suggestionFailed: "Could not suggest a description.",
    suggestionHint: "Review the suggestion, then save to use it. Suggestions are never saved automatically.",
    tone: "Tone",
    audience: "Audience",
    instructions: "Additional instructions",
    glossaryContext: "Use glossary rules as model context",
    approvedContext: "Use approved and manual translations as model context",
    precedence: "Placeholders and variables are preserved first; protected glossary rules and exact manual translations take precedence. Project instructions guide new translations within those limits.",
    currentRuntime: "Current runtime",
    hasKey: "API key available",
    missingKey: "API key missing",
    reconnectRequired: "Provider translation is paused after the workspace transfer. Add a destination-owned API key and save to reconnect; the previous key cannot be recovered.",
    customProviderWarning:
      "For Ollama/local gateways, the Vercel runtime must be able to reach the base URL. localhost on your laptop is not reachable from production.",
    providers: {
      openai: "OpenAI models. Default model is gpt-5-mini — best $/quality ratio for translation.",
      gemini: "Google Gemini models for automatic translations.",
      openrouter: "OpenRouter model ids such as openai/gpt-5-mini, google/gemini-3-pro or anthropic/claude-sonnet-4.6.",
      ollama: "Ollama or another local OpenAI-compatible endpoint.",
      "openai-compatible": "Any OpenAI-compatible API gateway, proxy, or self-hosted endpoint.",
      deepl: "DeepL translation API. No model id is needed.",
      mock: "Development-only placeholder provider.",
    },
  },
  de: {
    title: "Übersetzungsanbieter",
    description:
      "Wähle den Anbieter und das Modell für nicht gecachte automatische Übersetzungen. Projekteinstellungen überschreiben die Workspace-Umgebungsvariablen.",
    workspaceDefault: "Workspace-Standard",
    provider: "Anbieter",
    model: "Modell",
    modelHint: "Wähle ein Preset oder gib eine beliebige anbieterspezifische Modell-ID ein.",
    baseUrl: "Base URL",
    apiKey: "API-Key",
    apiKeyPlaceholder: "Leer lassen, um den bestehenden oder Workspace-Key zu verwenden",
    clearApiKey: "Gespeicherten Projekt-API-Key löschen",
    save: "Einstellungen speichern",
    saving: "Wird gespeichert...",
    saved: "Sprachmodell-Einstellungen gespeichert.",
    failed: "Sprachmodell-Einstellungen konnten nicht gespeichert werden.",
    contextTitle: "Übersetzungskontext",
    websiteDescription: "Websitebeschreibung",
    suggestDescription: "Aus Projektdaten vorschlagen",
    suggestionFailed: "Beschreibung konnte nicht vorgeschlagen werden.",
    suggestionHint: "Prüfe den Vorschlag und speichere ihn dann. Vorschläge werden nie automatisch gespeichert.",
    tone: "Tonalität",
    audience: "Zielgruppe",
    instructions: "Zusätzliche Anweisungen",
    glossaryContext: "Glossarregeln als Modellkontext verwenden",
    approvedContext: "Freigegebene und manuelle Übersetzungen als Modellkontext verwenden",
    precedence: "Platzhalter und Variablen bleiben vorrangig erhalten; geschützte Glossarregeln und exakte manuelle Übersetzungen haben Vorrang. Projektanweisungen leiten neue Übersetzungen innerhalb dieser Grenzen.",
    currentRuntime: "Aktive Laufzeit",
    hasKey: "API-Key verfügbar",
    missingKey: "API-Key fehlt",
    reconnectRequired: "Provider-Übersetzungen sind nach dem Workspace-Transfer pausiert. Hinterlege einen API-Key des Ziel-Workspace und speichere ihn, um die Verbindung wiederherzustellen; der bisherige Key kann nicht wiederhergestellt werden.",
    customProviderWarning:
      "Für Ollama/lokale Gateways muss die Vercel-Laufzeit die Base URL erreichen können. localhost auf deinem Laptop ist in Production nicht erreichbar.",
    providers: {
      openai: "OpenAI-Modelle. Standardmodell ist gpt-5-mini — bestes Preis/Qualitäts-Verhältnis für Übersetzungen.",
      gemini: "Google-Gemini-Modelle für automatische Übersetzungen.",
      openrouter: "OpenRouter-Modell-IDs wie openai/gpt-5-mini, google/gemini-3-pro oder anthropic/claude-sonnet-4.6.",
      ollama: "Ollama oder ein anderer lokaler OpenAI-kompatibler Endpoint.",
      "openai-compatible": "Beliebiger OpenAI-kompatibler API-Gateway, Proxy oder selbst gehosteter Endpoint.",
      deepl: "DeepL Translation API. Es wird keine Modell-ID benötigt.",
      mock: "Platzhalter-Anbieter für Entwicklung.",
    },
  },
} as const;

function needsModel(provider: string | null) {
  return (
    provider === "openai" ||
    provider === "gemini" ||
    provider === "openrouter" ||
    provider === "ollama" ||
    provider === "openai-compatible"
  );
}

function needsBaseUrl(provider: string | null) {
  return provider === "ollama" || provider === "openai-compatible";
}

export function LanguageModelSettingsCard({
  projectId,
  locale,
  initialSettings,
  initialEffective,
  providers,
}: {
  projectId: string;
  locale: SiteLocale;
  initialSettings: LanguageModelSettings;
  initialEffective: EffectiveSettings;
  providers: ProviderOption[];
}) {
  const copy = localizeCopy(locale, COPY);
  const [provider, setProvider] = useState(initialSettings.provider ?? "");
  const [model, setModel] = useState(initialSettings.model ?? "");
  const [baseUrl, setBaseUrl] = useState(initialSettings.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [websiteDescription, setWebsiteDescription] = useState(initialSettings.websiteDescription ?? "");
  const [translationTone, setTranslationTone] = useState(initialSettings.translationTone ?? "");
  const [translationAudience, setTranslationAudience] = useState(initialSettings.translationAudience ?? "");
  const [translationInstructions, setTranslationInstructions] = useState(initialSettings.translationInstructions ?? "");
  const [useGlossaryAsContext, setUseGlossaryAsContext] = useState(initialSettings.useGlossaryAsContext ?? false);
  const [useApprovedTranslationsAsContext, setUseApprovedTranslationsAsContext] = useState(initialSettings.useApprovedTranslationsAsContext ?? false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [effective, setEffective] = useState(initialEffective);
  const [hasProjectApiKey, setHasProjectApiKey] = useState(
    initialSettings.hasProjectApiKey
  );
  const [reconnectRequired, setReconnectRequired] = useState(initialSettings.providerReconnectRequired ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const selectedProvider = provider || null;
  const selectedProviderOption = providers.find((item) => item.id === selectedProvider);

  async function suggestDescription() {
    setIsSuggesting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/language-model`, { method: "POST" });
      const data = (await response.json()) as { suggestion?: string };
      if (!response.ok || !data.suggestion) throw new Error();
      setWebsiteDescription(data.suggestion);
    } catch {
      toast.error(copy.suggestionFailed);
    } finally {
      setIsSuggesting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/language-model`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          model: needsModel(selectedProvider) ? model : null,
          baseUrl: baseUrl || null,
          apiKey: apiKey || undefined,
          apiKeyAction: clearApiKey ? "clear" : "keep",
          websiteDescription,
          translationTone,
          translationAudience,
          translationInstructions,
          useGlossaryAsContext,
          useApprovedTranslationsAsContext,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        settings?: LanguageModelSettings;
        effective?: EffectiveSettings;
      };

      if (!response.ok || !data.settings || !data.effective) {
        toast.error(data.error ?? copy.failed);
        return;
      }

      setApiKey("");
      setClearApiKey(false);
      setEffective(data.effective);
      setHasProjectApiKey(data.settings.hasProjectApiKey);
      setReconnectRequired(data.settings.providerReconnectRequired ?? false);
      toast.success(copy.saved);
    } catch {
      toast.error(copy.failed);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <div className="p-6 border-b border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900">{copy.title}</h3>
        <p className="mt-1 text-sm text-gray-500">{copy.description}</p>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        {reconnectRequired && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{copy.reconnectRequired}</p>}
        <div className="grid gap-2">
          <Label htmlFor="translationProvider">{copy.provider}</Label>
          <select
            id="translationProvider"
            data-testid="translation-provider-select"
            value={provider}
            onChange={(event) => {
              const nextProvider = event.target.value;
              if (nextProvider !== provider) setModel("");
              setProvider(nextProvider);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="">{copy.workspaceDefault}</option>
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          {selectedProvider && (
            <p className="text-xs text-gray-500">
              {copy.providers[selectedProvider as keyof typeof copy.providers]}
            </p>
          )}
        </div>

        {needsModel(selectedProvider) && (
          <div className="grid gap-2">
            <Label htmlFor="translationModel">{copy.model}</Label>
            <Input
              id="translationModel"
              list="translationModelPresets"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={selectedProviderOption?.recommendedModels[0] ?? "gpt-5-mini"}
            />
            <datalist id="translationModelPresets">
              {selectedProviderOption?.recommendedModels.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <p className="text-xs text-gray-500">{copy.modelHint}</p>
          </div>
        )}

        {(needsBaseUrl(selectedProvider) || baseUrl) && (
          <div className="grid gap-2">
            <Label htmlFor="translationBaseUrl">{copy.baseUrl}</Label>
            <Input
              id="translationBaseUrl"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={
                selectedProvider === "ollama"
                  ? "http://localhost:11434/v1"
                  : "https://gateway.example.com/v1"
              }
            />
            {(selectedProvider === "ollama" ||
              selectedProvider === "openai-compatible") && (
              <p className="text-xs text-amber-700">{copy.customProviderWarning}</p>
            )}
          </div>
        )}

        {selectedProvider && selectedProvider !== "mock" && (
          <div className="grid gap-2">
            <Label htmlFor="translationApiKey">{copy.apiKey}</Label>
            <Input
              id="translationApiKey"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={copy.apiKeyPlaceholder}
            />
            {hasProjectApiKey && (
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={clearApiKey}
                  onChange={(event) => setClearApiKey(event.target.checked)}
                />
                {copy.clearApiKey}
              </label>
            )}
          </div>
        )}

        <div className="space-y-4 border-t border-gray-100 pt-5">
          <h4 className="font-semibold text-gray-900">{copy.contextTitle}</h4>
          <div className="grid gap-2">
            <Label htmlFor="websiteDescription">{copy.websiteDescription}</Label>
            <textarea id="websiteDescription" className="min-h-24 rounded-md border border-input px-3 py-2 text-sm" maxLength={1200} value={websiteDescription} onChange={(event) => setWebsiteDescription(event.target.value)} />
            <div><Button type="button" variant="outline" disabled={isSuggesting || isSaving} onClick={suggestDescription}>{copy.suggestDescription}</Button></div>
            <p className="text-xs text-gray-500">{copy.suggestionHint}</p>
          </div>
          <div className="grid gap-2"><Label htmlFor="translationTone">{copy.tone}</Label><Input id="translationTone" maxLength={160} value={translationTone} onChange={(event) => setTranslationTone(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="translationAudience">{copy.audience}</Label><Input id="translationAudience" maxLength={300} value={translationAudience} onChange={(event) => setTranslationAudience(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="translationInstructions">{copy.instructions}</Label><textarea id="translationInstructions" className="min-h-24 rounded-md border border-input px-3 py-2 text-sm" maxLength={1000} value={translationInstructions} onChange={(event) => setTranslationInstructions(event.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useGlossaryAsContext} onChange={(event) => setUseGlossaryAsContext(event.target.checked)} />{copy.glossaryContext}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useApprovedTranslationsAsContext} onChange={(event) => setUseApprovedTranslationsAsContext(event.target.checked)} />{copy.approvedContext}</label>
          <p className="text-xs text-gray-500">{copy.precedence}</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
          <p className="font-semibold text-gray-900">{copy.currentRuntime}</p>
          <p className="mt-1 text-gray-600" data-testid="translation-runtime-provider">
            {effective.providerLabel}
            {effective.model ? ` · ${effective.model}` : ""}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {effective.hasApiKey || effective.provider === "mock"
              ? copy.hasKey
              : copy.missingKey}
            {effective.baseUrl ? ` · ${effective.baseUrl}` : ""}
          </p>
        </div>

        <Button type="submit" disabled={isSaving} className="bg-brand-600 hover:bg-brand-700">
          {isSaving ? copy.saving : copy.save}
        </Button>
      </form>
    </div>
  );
}
