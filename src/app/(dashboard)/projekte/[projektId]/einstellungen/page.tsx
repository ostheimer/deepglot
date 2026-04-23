import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsToggle } from "@/components/projekte/settings-toggle";
import { getRequestLocale } from "@/lib/request-locale";
import { getLanguageName } from "@/lib/language-names";
import { RuntimeSyncBanner } from "@/components/projekte/runtime-sync-banner";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

const WEBSITE_TYPES = [
  "Blog", "Corporate website", "E-Commerce store", "Hotel website",
  "Media website", "Online service", "Showcase website",
  "Just testing Deepglot", "Other",
];

const INDUSTRY_TYPES = [
  "Banking & finance", "Business services", "Consumer services", "Education",
  "Media & Entertainment", "Food & Beverage", "Government & non-profit",
  "Health & medical", "Insurance & legal", "Retail & Fashion",
  "Real estate & property", "Software & technology", "Hospitality & tourism", "Other",
];

export default async function EinstellungenGeneralPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { settings: true },
  });
  if (!project) notFound();

  const s = project.settings;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">
          {locale === "de" ? "Allgemein" : "General"}
        </h2>
      </div>

      <div className="mb-5">
        <RuntimeSyncBanner
          locale={locale}
          domain={project.domain}
          runtimeSyncedAt={s?.runtimeSyncedAt}
        />
      </div>

      <div className="space-y-0">
        {/* Project info */}
        <section className="bg-white border border-gray-200 rounded-t-xl p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {locale === "de" ? "Projektname" : "Project name"}
              </Label>
              <Input defaultValue={project.name} className="h-9" readOnly />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Website URL
              </Label>
              <div className="relative">
                <Input
                  defaultValue={`https://${project.domain}`}
                  className="h-9 pr-9"
                  readOnly
                />
                <a
                  href={`https://${project.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-indigo-600"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-1.5">
            <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {locale === "de" ? "Originalsprache" : "Original language"}
            </Label>
            <p className="text-xs text-gray-500">
              {locale === "de"
                ? "Muss mit der Originalsprache deiner Website übereinstimmen."
                : "Must match the original language of your website."}
            </p>
            <select
              disabled
              className="flex h-9 w-48 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-70"
            >
              {["de", "en", "fr", "es", "it"].map((code) => (
                <option key={code} value={code} selected={project.originalLang === code}>
                  {getLanguageName(code, locale)}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Toggles */}
        <SettingsToggle
          label={locale === "de" ? "Auto-Weiterleitung" : "Automatic redirect"}
          description={locale === "de"
            ? "Aktiviere die automatische Weiterleitung, um Besucher basierend auf ihrer Browser-Sprache umzuleiten."
            : "Redirect visitors automatically based on their browser language."}
          defaultChecked={s?.autoSwitch ?? false}
          disabled
          className="border-x border-gray-200"
        />
        <SettingsToggle
          label={locale === "de" ? "KI-Übersetzungshinweis anzeigen" : "Show AI translation notice"}
          description={locale === "de"
            ? "Fügt deiner Website einen Hinweis hinzu, dass bestimmte Inhalte durch KI übersetzt wurden."
            : "Adds a notice to your website that some content was translated with AI."}
          defaultChecked={s?.displayAiNotice ?? false}
          disabled
          className="border-x border-gray-200"
        />
        <SettingsToggle
          label={locale === "de" ? "Automatische Inhaltsübersetzung" : "Automatic content translation"}
          description={locale === "de"
            ? "Wenn aktiviert (Standard), erkennt und übersetzt Deepglot Inhalte automatisch. Wenn deaktiviert, musst du erkannte Inhalte manuell freigeben."
            : "When enabled, Deepglot detects and translates content automatically. When disabled, you approve detected content manually."}
          defaultChecked={s?.automaticTranslation ?? true}
          disabled
          className="border-x border-gray-200"
        />
        <div className="bg-white border-x border-gray-200 p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">
                {locale === "de" ? "Übersetzungsgedächtnis (Beta)" : "Translation memory (beta)"}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {locale === "de"
                  ? "Das Übersetzungsgedächtnis ist ab dem Professional-Plan verfügbar."
                  : "Translation memory is available starting with the Professional plan."}
              </p>
            </div>
            <div className="relative">
              <input type="checkbox" disabled className="sr-only" />
              <div className="h-5 w-9 rounded-full bg-gray-200 cursor-not-allowed opacity-50" />
            </div>
          </div>
        </div>

        {/* Website type + Industry */}
        <section className="bg-white border border-gray-200 rounded-b-xl p-6">
          <p className="text-sm text-gray-500 mb-5">
            {locale === "de"
              ? "Fülle diese Informationen aus, um von verbesserten automatischen Übersetzungen zu profitieren. Der Typ und die Branche deiner Website helfen uns, die Übersetzung an deinen Fall anzupassen."
              : "Fill out this information to improve automatic translations. Your website type and industry help us adapt translations to your use case."}
          </p>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-3">
                {locale === "de" ? "Was möchtest du aufbauen?" : "What are you building?"}
              </p>
              <p className="text-xs text-gray-500 mb-3">
                {locale === "de" ? "Wähle den Typ deiner Website" : "Choose your website type"}
              </p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="websiteType" value="" defaultChecked={!s?.websiteType} disabled
                    className="h-3.5 w-3.5 text-indigo-600" />
                  <span className="text-sm text-gray-700">{locale === "de" ? "Keine Angabe" : "Not specified"}</span>
                </label>
                {WEBSITE_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="websiteType" value={t} disabled
                      defaultChecked={s?.websiteType === t}
                      className="h-3.5 w-3.5 text-indigo-600" />
                    <span className="text-sm text-gray-700">{t}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-3">
                {locale === "de" ? "Worum geht es auf deiner Website?" : "What is your website about?"}
              </p>
              <p className="text-xs text-gray-500 mb-3">
                {locale === "de" ? "Wähle die Branche" : "Choose the industry"}
              </p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="industryType" value="" defaultChecked={!s?.industryType} disabled
                    className="h-3.5 w-3.5 text-indigo-600" />
                  <span className="text-sm text-gray-700">{locale === "de" ? "Keine Angabe" : "Not specified"}</span>
                </label>
                {INDUSTRY_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="industryType" value={t} disabled
                      defaultChecked={s?.industryType === t}
                      className="h-3.5 w-3.5 text-indigo-600" />
                    <span className="text-sm text-gray-700">{t}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
