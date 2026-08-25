"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { SettingsToggle } from "@/components/projekte/settings-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getLanguageName } from "@/lib/language-names";
import {
  INDUSTRY_TYPES,
  SOURCE_LANGUAGE_MIGRATION_COPY,
  WEBSITE_TYPES,
} from "@/lib/project-general-settings-options";
import { getProjectUrl } from "@/lib/project-url";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

export type ProjectGeneralSettingsFormValue = {
  version: string;
  name: string;
  domain: string;
  sourceLanguage: string;
  targetLanguages: string[];
  sourceLanguageLocked: boolean;
  autoRedirect: boolean;
  displayAiNotice: boolean;
  automaticTranslation: boolean;
  websiteType: string | null;
  industryType: string | null;
};

type FormMessage = {
  kind: "success" | "info" | "error" | "conflict";
  text: string;
};

type ApiError = {
  code?: string;
};

const WEBSITE_TYPE_GERMAN: Readonly<Record<string, string>> = {
  Blog: "Blog",
  "Corporate website": "Unternehmenswebsite",
  "E-Commerce store": "Online-Shop",
  "Hotel website": "Hotelwebsite",
  "Media website": "Medienwebsite",
  "Online service": "Online-Dienst",
  "Showcase website": "Portfolio-Website",
  "Just testing Deepglot": "Deepglot nur testen",
  Other: "Sonstiges",
};

const INDUSTRY_TYPE_GERMAN: Readonly<Record<string, string>> = {
  "Banking & finance": "Banken & Finanzen",
  "Business services": "Unternehmensdienstleistungen",
  "Consumer services": "Verbraucherdienstleistungen",
  Education: "Bildung",
  "Media & Entertainment": "Medien & Unterhaltung",
  "Food & Beverage": "Lebensmittel & Getränke",
  "Government & non-profit": "Öffentlicher Sektor & gemeinnützige Organisationen",
  "Health & medical": "Gesundheit & Medizin",
  "Insurance & legal": "Versicherungen & Recht",
  "Retail & Fashion": "Einzelhandel & Mode",
  "Real estate & property": "Immobilien",
  "Software & technology": "Software & Technologie",
  "Hospitality & tourism": "Gastgewerbe & Tourismus",
  Other: "Sonstiges",
};

function settingsFromApi(
  value: unknown,
  previous: ProjectGeneralSettingsFormValue,
): ProjectGeneralSettingsFormValue | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<ProjectGeneralSettingsFormValue>;

  if (
    typeof payload.version !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.domain !== "string" ||
    typeof payload.sourceLanguage !== "string" ||
    !Array.isArray(payload.targetLanguages) ||
    payload.targetLanguages.some((language) => typeof language !== "string") ||
    typeof payload.autoRedirect !== "boolean" ||
    typeof payload.displayAiNotice !== "boolean" ||
    typeof payload.automaticTranslation !== "boolean"
  ) {
    return null;
  }

  return {
    version: payload.version,
    name: payload.name,
    domain: payload.domain,
    sourceLanguage: payload.sourceLanguage,
    targetLanguages: payload.targetLanguages,
    sourceLanguageLocked:
      typeof payload.sourceLanguageLocked === "boolean"
        ? payload.sourceLanguageLocked
        : previous.sourceLanguageLocked,
    autoRedirect: payload.autoRedirect,
    displayAiNotice: payload.displayAiNotice,
    automaticTranslation: payload.automaticTranslation,
    websiteType:
      typeof payload.websiteType === "string" ? payload.websiteType : null,
    industryType:
      typeof payload.industryType === "string" ? payload.industryType : null,
  };
}

function optionLabel(
  locale: SiteLocale,
  value: string,
  germanLabels: Readonly<Record<string, string>>,
) {
  return uiText(locale, value, germanLabels[value]);
}

export function ProjectGeneralSettingsForm({
  projectId,
  locale,
  initialSettings,
}: {
  projectId: string;
  locale: SiteLocale;
  initialSettings: ProjectGeneralSettingsFormValue;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [baseline, setBaseline] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [message, setMessage] = useState<FormMessage | null>(null);

  const copy = {
    projectDetails: uiText(locale, "Project details", "Projektdetails"),
    projectDetailsDescription: uiText(
      locale,
      "Manage the identity and original language of this project.",
      "Verwalte die Identität und Originalsprache dieses Projekts.",
    ),
    projectName: uiText(locale, "Project name", "Projektname"),
    websiteUrl: uiText(locale, "Website URL", "Website-URL"),
    websiteUrlHelp: uiText(
      locale,
      "Enter the website host, for example example.com. Paths and query parameters are not allowed.",
      "Gib den Host der Website ein, zum Beispiel example.com. Pfade und Abfrageparameter sind nicht erlaubt.",
    ),
    openWebsite: uiText(
      locale,
      "Open website in a new tab",
      "Website in neuem Tab öffnen",
    ),
    originalLanguage: uiText(
      locale,
      "Original language",
      "Originalsprache",
    ),
    sourceLocked: uiText(
      locale,
      "The original language cannot be changed after translations or language-dependent content exist.",
      "Die Originalsprache kann nicht geändert werden, sobald Übersetzungen oder sprachabhängige Inhalte vorhanden sind.",
    ),
    sourceUnlocked: uiText(
      locale,
      SOURCE_LANGUAGE_MIGRATION_COPY.en,
      SOURCE_LANGUAGE_MIGRATION_COPY.de,
    ),
    translationBehavior: uiText(
      locale,
      "Translation behavior",
      "Übersetzungsverhalten",
    ),
    translationBehaviorDescription: uiText(
      locale,
      "These settings are managed by Deepglot and delivered to the connected WordPress plugin.",
      "Diese Einstellungen werden von Deepglot verwaltet und an das verbundene WordPress-Plugin übertragen.",
    ),
    autoRedirect: uiText(
      locale,
      "Automatic redirect",
      "Auto-Weiterleitung",
    ),
    autoRedirectDescription: uiText(
      locale,
      "Redirect first-time visitors based on their browser language.",
      "Leite Erstbesucher anhand ihrer Browser-Sprache weiter.",
    ),
    aiNotice: uiText(
      locale,
      "Show AI translation notice",
      "KI-Übersetzungshinweis anzeigen",
    ),
    aiNoticeDescription: uiText(
      locale,
      "Show a notice when website content was translated with AI.",
      "Zeige einen Hinweis an, wenn Website-Inhalte mit KI übersetzt wurden.",
    ),
    automaticTranslation: uiText(
      locale,
      "Automatic content translation",
      "Automatische Inhaltsübersetzung",
    ),
    automaticTranslationDescription: uiText(
      locale,
      "Translate newly detected content automatically. When disabled, only existing translations are served.",
      "Übersetze neu erkannte Inhalte automatisch. Wenn diese Option deaktiviert ist, werden nur vorhandene Übersetzungen ausgeliefert.",
    ),
    context: uiText(locale, "Translation context", "Übersetzungskontext"),
    contextDescription: uiText(
      locale,
      "Describe the website so translation providers can adapt terminology to its context.",
      "Beschreibe die Website, damit Übersetzungsanbieter ihre Terminologie an den Kontext anpassen können.",
    ),
    websiteType: uiText(locale, "Website type", "Website-Typ"),
    industry: uiText(locale, "Industry", "Branche"),
    notSpecified: uiText(locale, "Not specified", "Keine Angabe"),
    save: uiText(
      locale,
      "Save project settings",
      "Projekteinstellungen speichern",
    ),
    saving: uiText(
      locale,
      "Saving project settings...",
      "Projekteinstellungen werden gespeichert...",
    ),
    saved: uiText(
      locale,
      "Project settings saved.",
      "Projekteinstellungen gespeichert.",
    ),
    noChanges: uiText(
      locale,
      "There are no changes to save.",
      "Es gibt keine Änderungen zu speichern.",
    ),
    saveFailed: uiText(
      locale,
      "Project settings could not be saved.",
      "Die Projekteinstellungen konnten nicht gespeichert werden.",
    ),
    conflict: uiText(
      locale,
      "These settings changed elsewhere. Reload the current settings before saving again.",
      "Diese Einstellungen wurden an anderer Stelle geändert. Lade den aktuellen Stand, bevor du erneut speicherst.",
    ),
    sourceChangeBlocked: uiText(
      locale,
      "The original language can no longer be changed because language-dependent content exists.",
      "Die Originalsprache kann nicht mehr geändert werden, weil sprachabhängige Inhalte vorhanden sind.",
    ),
    sourceMustBeTarget: uiText(
      locale,
      "Choose one of the project's active target languages as the new original language.",
      "Wähle eine aktive Zielsprache des Projekts als neue Originalsprache.",
    ),
    reload: uiText(
      locale,
      "Reload current settings",
      "Aktuelle Einstellungen laden",
    ),
    reloading: uiText(
      locale,
      "Reloading current settings...",
      "Aktuelle Einstellungen werden geladen...",
    ),
    reloaded: uiText(
      locale,
      "Current project settings loaded.",
      "Aktuelle Projekteinstellungen geladen.",
    ),
    reloadFailed: uiText(
      locale,
      "Current project settings could not be loaded.",
      "Die aktuellen Projekteinstellungen konnten nicht geladen werden.",
    ),
    currentValue: uiText(locale, "current value", "aktueller Wert"),
  };

  const sourceLanguages = useMemo(() => {
    const languageCodes = new Set([
      baseline.sourceLanguage,
      settings.sourceLanguage,
      ...settings.targetLanguages,
    ]);
    const entries = Array.from(languageCodes, (code) => ({
      code,
      label:
        code === baseline.sourceLanguage
          ? `${getLanguageName(code, locale)} (${copy.currentValue})`
          : getLanguageName(code, locale),
    }));

    return entries.sort((left, right) =>
      left.label.localeCompare(right.label, locale),
    );
  }, [
    copy.currentValue,
    baseline.sourceLanguage,
    locale,
    settings.sourceLanguage,
    settings.targetLanguages,
  ]);

  const savedWebsiteUrl = useMemo(() => {
    try {
      const url = new URL(getProjectUrl(baseline.domain));
      return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
    } catch {
      return null;
    }
  }, [baseline.domain]);

  function update<K extends keyof ProjectGeneralSettingsFormValue>(
    key: K,
    value: ProjectGeneralSettingsFormValue[K],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  function applyFreshSettings(fresh: ProjectGeneralSettingsFormValue) {
    setSettings(fresh);
    setBaseline(fresh);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || reloading) return;

    const payload: Record<string, unknown> = {
      expectedVersion: baseline.version,
    };
    if (settings.name !== baseline.name) payload.name = settings.name;
    if (settings.domain !== baseline.domain) payload.domain = settings.domain;
    if (settings.sourceLanguage !== baseline.sourceLanguage) {
      payload.sourceLanguage = settings.sourceLanguage;
    }
    if (settings.autoRedirect !== baseline.autoRedirect) {
      payload.autoRedirect = settings.autoRedirect;
    }
    if (settings.displayAiNotice !== baseline.displayAiNotice) {
      payload.displayAiNotice = settings.displayAiNotice;
    }
    if (settings.automaticTranslation !== baseline.automaticTranslation) {
      payload.automaticTranslation = settings.automaticTranslation;
    }
    if (settings.websiteType !== baseline.websiteType) {
      payload.websiteType = settings.websiteType;
    }
    if (settings.industryType !== baseline.industryType) {
      payload.industryType = settings.industryType;
    }

    if (Object.keys(payload).length === 1) {
      setMessage({ kind: "info", text: copy.noChanges });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const responseBody = (await response.json().catch(() => null)) as
        | (ApiError & Partial<ProjectGeneralSettingsFormValue>)
        | null;

      if (!response.ok) {
        if (response.status === 409) {
          setMessage({
            kind: "conflict",
            text:
              responseBody?.code === "original_language_locked"
                ? copy.sourceChangeBlocked
                : responseBody?.code ===
                    "source_language_must_be_active_target"
                  ? copy.sourceMustBeTarget
                : copy.conflict,
          });
          return;
        }

        setMessage({
          kind: "error",
          text: copy.saveFailed,
        });
        return;
      }

      const fresh = settingsFromApi(responseBody, settings);
      if (!fresh) {
        setMessage({ kind: "error", text: copy.saveFailed });
        return;
      }

      applyFreshSettings(fresh);
      setMessage({ kind: "success", text: copy.saved });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: copy.saveFailed });
    } finally {
      setSaving(false);
    }
  }

  async function reloadCurrentSettings() {
    if (saving || reloading) return;
    setReloading(true);

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}`,
        { cache: "no-store" },
      );
      const responseBody = (await response.json().catch(() => null)) as unknown;
      const fresh = response.ok
        ? settingsFromApi(responseBody, baseline)
        : null;

      if (!fresh) {
        setMessage({ kind: "error", text: copy.reloadFailed });
        return;
      }

      applyFreshSettings(fresh);
      setMessage({ kind: "success", text: copy.reloaded });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: copy.reloadFailed });
    } finally {
      setReloading(false);
    }
  }

  const sourceLanguageHelpId = "project-source-language-help";
  const websiteUrlHelpId = "project-website-url-help";
  const contextHelpId = "project-translation-context-help";

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5"
      aria-busy={saving || reloading}
    >
      <section
        className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6"
        aria-labelledby="project-details-heading"
      >
        <h3
          id="project-details-heading"
          className="text-base font-semibold text-gray-900"
        >
          {copy.projectDetails}
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          {copy.projectDetailsDescription}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label
              htmlFor="project-name"
              className="text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              {copy.projectName}
            </Label>
            <Input
              id="project-name"
              name="name"
              value={settings.name}
              onChange={(event) => update("name", event.target.value)}
              required
              maxLength={120}
              disabled={saving || reloading}
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="website-url"
              className="text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              {copy.websiteUrl}
            </Label>
            <div className="relative">
              <Input
                id="website-url"
                name="domain"
                value={settings.domain}
                onChange={(event) => update("domain", event.target.value)}
                required
                maxLength={255}
                inputMode="url"
                aria-describedby={websiteUrlHelpId}
                disabled={saving || reloading}
                className="h-9 pr-10"
              />
              {savedWebsiteUrl ? (
                <a
                  href={savedWebsiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={copy.openWebsite}
                  title={copy.openWebsite}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm text-gray-400 hover:text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              ) : null}
            </div>
            <p id={websiteUrlHelpId} className="text-xs text-gray-500">
              {copy.websiteUrlHelp}
            </p>
          </div>
        </div>

        <div className="mt-5 max-w-md space-y-1.5">
          <Label
            htmlFor="original-language"
            className="text-xs font-semibold uppercase tracking-wider text-gray-500"
          >
            {copy.originalLanguage}
          </Label>
          <select
            id="original-language"
            name="sourceLanguage"
            value={settings.sourceLanguage}
            onChange={(event) => update("sourceLanguage", event.target.value)}
            disabled={settings.sourceLanguageLocked || saving || reloading}
            aria-describedby={sourceLanguageHelpId}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:w-64"
          >
            {sourceLanguages.map(({ code, label }) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <p
            id={sourceLanguageHelpId}
            className={
              settings.sourceLanguageLocked
                ? "text-xs text-amber-700"
                : "text-xs text-gray-500"
            }
          >
            {settings.sourceLanguageLocked
              ? copy.sourceLocked
              : copy.sourceUnlocked}
          </p>
        </div>
      </section>

      <section
        className="overflow-hidden rounded-xl border border-gray-200 bg-white"
        aria-labelledby="translation-behavior-heading"
      >
        <div className="border-b border-gray-100 p-5 sm:px-6">
          <h3
            id="translation-behavior-heading"
            className="text-base font-semibold text-gray-900"
          >
            {copy.translationBehavior}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {copy.translationBehaviorDescription}
          </p>
        </div>
        <SettingsToggle
          label={copy.autoRedirect}
          description={copy.autoRedirectDescription}
          checked={settings.autoRedirect}
          onCheckedChange={(checked) => update("autoRedirect", checked)}
          disabled={saving || reloading}
          className="border-b border-gray-100"
        />
        <SettingsToggle
          label={copy.aiNotice}
          description={copy.aiNoticeDescription}
          checked={settings.displayAiNotice}
          onCheckedChange={(checked) => update("displayAiNotice", checked)}
          disabled={saving || reloading}
          className="border-b border-gray-100"
        />
        <SettingsToggle
          label={copy.automaticTranslation}
          description={copy.automaticTranslationDescription}
          checked={settings.automaticTranslation}
          onCheckedChange={(checked) => update("automaticTranslation", checked)}
          disabled={saving || reloading}
        />
      </section>

      <section
        className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6"
        aria-labelledby="translation-context-heading"
      >
        <h3
          id="translation-context-heading"
          className="text-base font-semibold text-gray-900"
        >
          {copy.context}
        </h3>
        <p id={contextHelpId} className="mt-1 text-sm text-gray-500">
          {copy.contextDescription}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="website-type">{copy.websiteType}</Label>
            <select
              id="website-type"
              name="websiteType"
              value={settings.websiteType ?? ""}
              onChange={(event) =>
                update("websiteType", event.target.value || null)
              }
              aria-describedby={contextHelpId}
              disabled={saving || reloading}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <option value="">{copy.notSpecified}</option>
              {settings.websiteType &&
              !WEBSITE_TYPES.includes(
                settings.websiteType as (typeof WEBSITE_TYPES)[number],
              ) ? (
                <option value={settings.websiteType}>
                  {settings.websiteType} ({copy.currentValue})
                </option>
              ) : null}
              {WEBSITE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {optionLabel(locale, type, WEBSITE_TYPE_GERMAN)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="industry-type">{copy.industry}</Label>
            <select
              id="industry-type"
              name="industryType"
              value={settings.industryType ?? ""}
              onChange={(event) =>
                update("industryType", event.target.value || null)
              }
              aria-describedby={contextHelpId}
              disabled={saving || reloading}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <option value="">{copy.notSpecified}</option>
              {settings.industryType &&
              !INDUSTRY_TYPES.includes(
                settings.industryType as (typeof INDUSTRY_TYPES)[number],
              ) ? (
                <option value={settings.industryType}>
                  {settings.industryType} ({copy.currentValue})
                </option>
              ) : null}
              {INDUSTRY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {optionLabel(locale, type, INDUSTRY_TYPE_GERMAN)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {message ? (
        message.kind === "error" || message.kind === "conflict" ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{message.text}</span>
            {message.kind === "conflict" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={reloadCurrentSettings}
                disabled={reloading || saving}
                className="shrink-0 border-red-300 bg-white text-red-700 hover:bg-red-100"
              >
                <RefreshCw
                  className={reloading ? "animate-spin" : undefined}
                  aria-hidden="true"
                />
                {reloading ? copy.reloading : copy.reload}
              </Button>
            ) : null}
          </div>
        ) : (
          <p
            role="status"
            className={
              message.kind === "success"
                ? "text-sm text-green-700"
                : "text-sm text-gray-600"
            }
          >
            {message.text}
          </p>
        )
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={saving || reloading}
          className="bg-brand-600 hover:bg-brand-700"
        >
          {saving ? copy.saving : copy.save}
        </Button>
      </div>
    </form>
  );
}
