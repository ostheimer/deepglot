import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Label } from "@/components/ui/label";
import { GripVertical, Edit2 } from "lucide-react";
import { SettingsToggle } from "@/components/projekte/settings-toggle";
import { getLanguageName } from "@/lib/language-names";
import { requireProjectManagement } from "@/lib/project-page-access";
import { getRequestLocale } from "@/lib/request-locale";
import { RuntimeSyncBanner } from "@/components/projekte/runtime-sync-banner";
import { localizeCopy, uiText } from "@/lib/static-copy";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

const FLAG_TYPES = {
  en: [
    { value: "rectangle_mat", label: "Rectangle mat" },
    { value: "rectangle_glossy", label: "Rectangle glossy" },
    { value: "circle_mat", label: "Circle mat" },
    { value: "circle_glossy", label: "Circle glossy" },
    { value: "none", label: "No flags" },
  ],
  de: [
    { value: "rectangle_mat", label: "Rechteck matt" },
    { value: "rectangle_glossy", label: "Rechteck glänzend" },
    { value: "circle_mat", label: "Kreis matt" },
    { value: "circle_glossy", label: "Kreis glänzend" },
    { value: "none", label: "Keine Flaggen" },
  ],
} as const;

const LANG_FLAGS: Record<string, string> = {
  de: "🇩🇪", en: "🇬🇧", fr: "🇫🇷", es: "🇪🇸", it: "🇮🇹",
  nl: "🇳🇱", pl: "🇵🇱", pt: "🇵🇹", ru: "🇷🇺", zh: "🇨🇳",
  ja: "🇯🇵", ar: "🇸🇦", tr: "🇹🇷", at: "🇦🇹",
};

export default async function SwitcherPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();
  await requireProjectManagement(projektId);

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { settings: true, languages: { orderBy: { langCode: "asc" } } },
  });
  if (!project) notFound();

  const s = project.settings;
  const flagStyleId = "switcher-flag-style";
  const customCssId = "switcher-custom-css";
  const flagTypes = localizeCopy(locale, FLAG_TYPES);
  const originalEditLabel =
    uiText(locale, "Edit original language appearance", "Darstellung der Originalsprache bearbeiten");

  return (
    <div className="max-w-3xl space-y-5">
      <h2 className="text-xl font-bold text-gray-900">
        {uiText(locale, "Language switcher", "Sprachauswahl")}
      </h2>

      <RuntimeSyncBanner
        locale={locale}
        domain={project.domain}
        runtimeSyncedAt={s?.runtimeSyncedAt}
      />

      {/* Appearance & position */}
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          {uiText(locale, "Appearance and position", "Erscheinungsbild und Position")}
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          {uiText(locale, "The language switcher is configured on your WordPress site. Values in Deepglot are read-only mirrors of the plugin configuration.", "Die Sprachauswahl wird auf deiner WordPress-Seite konfiguriert. Die Werte in Deepglot sind nur ein Spiegel der Plugin-Konfiguration.")}
        </p>
      </section>

      {/* Advanced options */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">
            {uiText(locale, "Advanced options", "Erweiterte Optionen")}
          </h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {uiText(locale, "These options are mirrored from WordPress and shown here as read-only values.", "Diese Optionen werden aus WordPress gespiegelt und hier schreibgeschützt angezeigt.")}
          </p>
        </div>

        <SettingsToggle
          label={uiText(locale, "Show language name", "Sprachname anzeigen")}
          description={uiText(locale, "Display the language name.", "Zeige den Namen der Sprache an.")}
          defaultChecked={s?.switcherDisplayName ?? true}
          disabled
        />
        <SettingsToggle
          label={uiText(locale, "Show full language name", "Vollständigen Sprachnamen anzeigen")}
          description={uiText(locale, "Use the full name (e.g. German) instead of the language code (e.g. DE).", "Vollständiger Name (z.B. Deutsch) anstatt Sprachcode (z.B. DE).")}
          defaultChecked={s?.switcherFullName ?? true}
          disabled
        />
        <SettingsToggle
          label={uiText(locale, "Show country flags", "Länderflaggen anzeigen")}
          description={uiText(locale, "Display flags in the language switcher.", "Zeige Flaggen im Sprachauswähler an.")}
          defaultChecked={s?.switcherFlags ?? true}
          disabled
        />
        <SettingsToggle
          label={uiText(locale, "Use dropdown mode", "Als Dropdown-Menü")}
          description={uiText(locale, "Render the language switcher as an expandable dropdown.", "Zeige den Sprachauswähler als aufklappbares Dropdown an.")}
          defaultChecked={s?.switcherDropdown ?? true}
          disabled
        />

        <div className="p-5 border-t border-gray-100 space-y-4">
          {/* Flag type */}
          <div className="space-y-1.5">
            <Label
              htmlFor={flagStyleId}
              className="text-xs font-semibold text-gray-500 uppercase tracking-wider"
            >
              {uiText(locale, "Flag style", "Flaggen-Typ")}
            </Label>
            <select
              id={flagStyleId}
              defaultValue={s?.switcherFlagsType ?? "rectangle_mat"}
              disabled
              className="flex h-9 w-64 rounded-md border border-input bg-white px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-70"
            >
              {flagTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400">
              {uiText(locale, "Style of country flags.", "Art der Länderflaggen.")}
            </p>
          </div>

          {/* Custom CSS */}
          <div className="space-y-1.5">
            <Label
              htmlFor={customCssId}
              className="text-xs font-semibold text-gray-500 uppercase tracking-wider"
            >
              {uiText(locale, "Custom CSS", "Benutzerdefiniertes CSS")}
            </Label>
            <textarea
              id={customCssId}
              defaultValue={s?.switcherCustomCss ?? ".language-selector {\n  margin-bottom: 20px;\n}"}
              rows={5}
              readOnly
              className="w-full rounded-md border border-input bg-gray-50 px-3 py-2 text-sm font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
            <p className="text-xs text-gray-400">
              {uiText(locale, "CSS applied to the language switcher or your website.", "CSS das auf den Sprachauswähler oder deine Website angewendet wird.")}
            </p>
          </div>

        </div>
      </section>

      {/* Languages appearance */}
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          {uiText(locale, "Language appearance", "Sprachdarstellung")}
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          {uiText(locale, "Language order, flags, and names are mirrored from the WordPress configuration.", "Die Reihenfolge, Flaggen und Namen werden aus der WordPress-Konfiguration gespiegelt.")}
        </p>

        <div className="border border-gray-100 rounded-lg overflow-hidden">
          {/* Original language */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <GripVertical className="h-4 w-4 text-gray-300" aria-hidden="true" />
              <span className="text-lg">{LANG_FLAGS[project.originalLang] ?? "🏳️"}</span>
              <span className="text-sm font-medium text-gray-700">
                {getLanguageName(project.originalLang, locale)}
              </span>
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                {uiText(locale, "Original", "Original")}
              </span>
            </div>
            <button
              type="button"
              className="h-7 w-7 p-0 opacity-40"
              disabled
              aria-label={originalEditLabel}
              title={originalEditLabel}
            >
              <Edit2 className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
            </button>
          </div>

          {/* Target languages */}
          {project.languages.map((lang, i) => (
            <div
              key={lang.id}
              className={`flex items-center justify-between px-4 py-3 ${
                i < project.languages.length - 1 ? "border-b border-gray-100" : ""
              } hover:bg-gray-50 transition-colors`}
            >
              <div className="flex items-center gap-3">
                <GripVertical className="h-4 w-4 text-gray-300" aria-hidden="true" />
                <span className="text-lg">{LANG_FLAGS[lang.langCode] ?? "🏳️"}</span>
                <span className="text-sm text-gray-700">
                  {getLanguageName(lang.langCode, locale)}
                </span>
              </div>
              <button
                type="button"
                className="h-7 w-7 p-0 opacity-40"
                disabled
                aria-label={
                  locale === "de"
                    ? `Darstellung für ${getLanguageName(lang.langCode, locale)} bearbeiten`
                    : `Edit ${getLanguageName(lang.langCode, locale)} appearance`
                }
                title={
                  locale === "de"
                    ? `Darstellung für ${getLanguageName(lang.langCode, locale)} bearbeiten`
                    : `Edit ${getLanguageName(lang.langCode, locale)} appearance`
                }
              >
                <Edit2 className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
              </button>
            </div>
          ))}

          {project.languages.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              {uiText(locale, "No translation languages configured yet.", "Noch keine Übersetzungssprachen konfiguriert.")}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
