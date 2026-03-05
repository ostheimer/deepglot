import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Copy, Save } from "lucide-react";
import { SettingsToggle } from "@/components/projekte/settings-toggle";

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

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { settings: true },
  });
  if (!project) notFound();

  const s = project.settings;

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Allgemein</h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-gray-400 hover:text-red-500">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-gray-400">
            <Copy className="h-4 w-4" />
          </Button>
          <Button className="bg-indigo-600 hover:bg-indigo-700 h-8 px-4 text-sm gap-1.5">
            <Save className="h-3.5 w-3.5" />
            Speichern
          </Button>
        </div>
      </div>

      <div className="space-y-0">
        {/* Project info */}
        <section className="bg-white border border-gray-200 rounded-t-xl p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Projektname
              </Label>
              <Input defaultValue={project.name} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Website URL
              </Label>
              <div className="relative">
                <Input
                  defaultValue={`https://${project.domain}`}
                  className="h-9 pr-9"
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
              Originalsprache
            </Label>
            <p className="text-xs text-gray-500">
              Muss mit der Originalsprache deiner Website übereinstimmen.
            </p>
            <select className="flex h-9 w-48 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs">
              <option value="de" selected={project.originalLang === "de"}>Deutsch</option>
              <option value="en" selected={project.originalLang === "en"}>Englisch</option>
              <option value="fr" selected={project.originalLang === "fr"}>Französisch</option>
              <option value="es" selected={project.originalLang === "es"}>Spanisch</option>
              <option value="it" selected={project.originalLang === "it"}>Italienisch</option>
            </select>
          </div>
        </section>

        {/* Toggles */}
        <SettingsToggle
          label="Auto-Weiterleitung"
          description="Aktiviere die automatische Weiterleitung, um Besucher basierend auf ihrer Browser-Sprache umzuleiten."
          defaultChecked={s?.autoSwitch ?? false}
          className="border-x border-gray-200"
        />
        <SettingsToggle
          label="KI-Übersetzungshinweis anzeigen"
          description="Fügt deiner Website einen Hinweis hinzu, dass bestimmte Inhalte durch KI übersetzt wurden."
          defaultChecked={s?.displayAiNotice ?? false}
          className="border-x border-gray-200"
        />
        <SettingsToggle
          label="Automatische Inhaltsübersetzung"
          description="Wenn aktiviert (Standard), erkennt und übersetzt Deepglot Inhalte automatisch. Wenn deaktiviert, musst du erkannte Inhalte manuell freigeben."
          defaultChecked={s?.automaticTranslation ?? true}
          className="border-x border-gray-200"
        />
        <div className="bg-white border-x border-gray-200 p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Übersetzungsgedächtnis (Beta)</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Das Übersetzungsgedächtnis ist ab dem Professional-Plan verfügbar.
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
            Fülle diese Informationen aus, um von verbesserten automatischen Übersetzungen zu profitieren.
            Der Typ und die Branche deiner Website helfen uns, die Übersetzung an deinen Fall anzupassen.
          </p>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-3">Was möchtest du aufbauen?</p>
              <p className="text-xs text-gray-500 mb-3">Wähle den Typ deiner Website</p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="websiteType" value="" defaultChecked={!s?.websiteType}
                    className="h-3.5 w-3.5 text-indigo-600" />
                  <span className="text-sm text-gray-700">Keine Angabe</span>
                </label>
                {WEBSITE_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="websiteType" value={t}
                      defaultChecked={s?.websiteType === t}
                      className="h-3.5 w-3.5 text-indigo-600" />
                    <span className="text-sm text-gray-700">{t}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-3">Worum geht es auf deiner Website?</p>
              <p className="text-xs text-gray-500 mb-3">Wähle die Branche</p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="industryType" value="" defaultChecked={!s?.industryType}
                    className="h-3.5 w-3.5 text-indigo-600" />
                  <span className="text-sm text-gray-700">Keine Angabe</span>
                </label>
                {INDUSTRY_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="industryType" value={t}
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
