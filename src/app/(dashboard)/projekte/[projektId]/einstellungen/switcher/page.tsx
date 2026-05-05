import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Label } from "@/components/ui/label";
import { GripVertical, Edit2 } from "lucide-react";
import { SettingsToggle } from "@/components/projekte/settings-toggle";
import { getLanguageName } from "@/lib/language-names";
import { requireProjectManagement } from "@/lib/project-page-access";
import { getRequestLocale } from "@/lib/request-locale";
import { RuntimeSyncBanner } from "@/components/projekte/runtime-sync-banner";

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
  const originalEditLabel =
    locale === "de"
      ? "Darstellung der Originalsprache bearbeiten"
      : "Edit original language appearance";

  return (
    <div className="max-w-3xl space-y-5">
      <h2 className="text-xl font-bold text-gray-900">
        {locale === "de" ? "Sprachauswahl" : "Language switcher"}
      </h2>

      <RuntimeSyncBanner
        locale={locale}
        domain={project.domain}
        runtimeSyncedAt={s?.runtimeSyncedAt}
      />

      {/* Appearance & position */}
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          {locale === "de" ? "Erscheinungsbild und Position" : "Appearance and position"}
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          {locale === "de"
            ? "Die Sprachauswahl wird auf deiner WordPress-Seite konfiguriert. Die Werte in Deepglot sind nur ein Spiegel der Plugin-Konfiguration."
            : "The language switcher is configured on your WordPress site. Values in Deepglot are read-only mirrors of the plugin configuration."}
        </p>
      </section>

      {/* Advanced options */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">
            {locale === "de" ? "Erweiterte Optionen" : "Advanced options"}
          </h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {locale === "de"
              ? "Diese Optionen werden aus WordPress gespiegelt und hier schreibgeschützt angezeigt."
              : "These options are mirrored from WordPress and shown here as read-only values."}
          </p>
        </div>

        <SettingsToggle
          label={locale === "de" ? "Sprachname anzeigen" : "Show language name"}
          description={locale === "de" ? "Zeige den Namen der Sprache an." : "Display the language name."}
          defaultChecked={s?.switcherDisplayName ?? true}
          disabled
        />
        <SettingsToggle
          label={locale === "de" ? "Vollständigen Sprachnamen anzeigen" : "Show full language name"}
          description={locale === "de"
            ? "Vollständiger Name (z.B. Deutsch) anstatt Sprachcode (z.B. DE)."
            : "Use the full name (e.g. German) instead of the language code (e.g. DE)."}
          defaultChecked={s?.switcherFullName ?? true}
          disabled
        />
        <SettingsToggle
          label={locale === "de" ? "Länderflaggen anzeigen" : "Show country flags"}
          description={locale === "de" ? "Zeige Flaggen im Sprachauswähler an." : "Display flags in the language switcher."}
          defaultChecked={s?.switcherFlags ?? true}
          disabled
        />
        <SettingsToggle
          label={locale === "de" ? "Als Dropdown-Menü" : "Use dropdown mode"}
          description={locale === "de"
            ? "Zeige den Sprachauswähler als aufklappbares Dropdown an."
            : "Render the language switcher as an expandable dropdown."}
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
              {locale === "de" ? "Flaggen-Typ" : "Flag style"}
            </Label>
            <select
              id={flagStyleId}
              defaultValue={s?.switcherFlagsType ?? "rectangle_mat"}
              disabled
              className="flex h-9 w-64 rounded-md border border-input bg-white px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-70"
            >
              {FLAG_TYPES[locale].map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400">
              {locale === "de" ? "Art der Länderflaggen." : "Style of country flags."}
            </p>
          </div>

          {/* Custom CSS */}
          <div className="space-y-1.5">
            <Label
              htmlFor={customCssId}
              className="text-xs font-semibold text-gray-500 uppercase tracking-wider"
            >
              {locale === "de" ? "Benutzerdefiniertes CSS" : "Custom CSS"}
            </Label>
            <textarea
              id={customCssId}
              defaultValue={s?.switcherCustomCss ?? ".language-selector {\n  margin-bottom: 20px;\n}"}
              rows={5}
              readOnly
              className="w-full rounded-md border border-input bg-gray-50 px-3 py-2 text-sm font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
            <p className="text-xs text-gray-400">
              {locale === "de"
                ? "CSS das auf den Sprachauswähler oder deine Website angewendet wird."
                : "CSS applied to the language switcher or your website."}
            </p>
          </div>

        </div>
      </section>

      {/* Languages appearance */}
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          {locale === "de" ? "Sprachdarstellung" : "Language appearance"}
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          {locale === "de"
            ? "Die Reihenfolge, Flaggen und Namen werden aus der WordPress-Konfiguration gespiegelt."
            : "Language order, flags, and names are mirrored from the WordPress configuration."}
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
                {locale === "de" ? "Original" : "Original"}
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
              {locale === "de" ? "Noch keine Übersetzungssprachen konfiguriert." : "No translation languages configured yet."}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
