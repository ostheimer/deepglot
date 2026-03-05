import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ExternalLink, GripVertical, Edit2 } from "lucide-react";
import { SettingsToggle } from "@/components/projekte/settings-toggle";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

const FLAG_TYPES = [
  { value: "rectangle_mat", label: "Rectangle mat" },
  { value: "rectangle_glossy", label: "Rectangle glossy" },
  { value: "circle_mat", label: "Circle mat" },
  { value: "circle_glossy", label: "Circle glossy" },
  { value: "none", label: "Keine Flaggen" },
];

const LANG_FLAGS: Record<string, string> = {
  de: "🇩🇪", en: "🇬🇧", fr: "🇫🇷", es: "🇪🇸", it: "🇮🇹",
  nl: "🇳🇱", pl: "🇵🇱", pt: "🇵🇹", ru: "🇷🇺", zh: "🇨🇳",
  ja: "🇯🇵", ar: "🇸🇦", tr: "🇹🇷", at: "🇦🇹",
};

const LANG_NAMES: Record<string, string> = {
  de: "Deutsch", en: "Englisch", fr: "Französisch", es: "Spanisch",
  it: "Italienisch", nl: "Niederländisch", pl: "Polnisch", pt: "Portugiesisch",
  ru: "Russisch", zh: "Chinesisch", ja: "Japanisch", ar: "Arabisch", tr: "Türkisch",
};

export default async function SwitcherPage({ params }: PageProps) {
  const { projektId } = await params;

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { settings: true, languages: { orderBy: { langCode: "asc" } } },
  });
  if (!project) notFound();

  const s = project.settings;

  return (
    <div className="max-w-3xl space-y-5">
      <h2 className="text-xl font-bold text-gray-900">Sprachauswahl</h2>

      {/* Appearance & position */}
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          Erscheinungsbild und Position
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          Nutze den interaktiven Editor, um den Sprachauswähler auf deiner Website
          per Drag & Drop zu positionieren und das Erscheinungsbild anzupassen.
        </p>
        <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2">
          <ExternalLink className="h-4 w-4" />
          Switcher-Editor öffnen
        </Button>
      </section>

      {/* Advanced options */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Erweiterte Optionen</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Passe das Erscheinungsbild des Sprachauswählers an.
          </p>
        </div>

        <SettingsToggle
          label="Sprachname anzeigen"
          description="Zeige den Namen der Sprache an."
          defaultChecked={s?.switcherDisplayName ?? true}
        />
        <SettingsToggle
          label="Vollständigen Sprachnamen anzeigen"
          description="Vollständiger Name (z.B. Deutsch) anstatt Sprachcode (z.B. DE)."
          defaultChecked={s?.switcherFullName ?? true}
        />
        <SettingsToggle
          label="Länderflaggen anzeigen"
          description="Zeige Flaggen im Sprachauswähler an."
          defaultChecked={s?.switcherFlags ?? true}
        />
        <SettingsToggle
          label="Als Dropdown-Menü"
          description="Zeige den Sprachauswähler als aufklappbares Dropdown an."
          defaultChecked={s?.switcherDropdown ?? true}
        />

        <div className="p-5 border-t border-gray-100 space-y-4">
          {/* Flag type */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Flaggen-Typ
            </Label>
            <select
              defaultValue={s?.switcherFlagsType ?? "rectangle_mat"}
              className="flex h-9 w-64 rounded-md border border-input bg-white px-3 py-1 text-sm"
            >
              {FLAG_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400">Art der Länderflaggen.</p>
          </div>

          {/* Custom CSS */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Benutzerdefiniertes CSS
            </Label>
            <textarea
              defaultValue={s?.switcherCustomCss ?? ".language-selector {\n  margin-bottom: 20px;\n}"}
              rows={5}
              className="w-full rounded-md border border-input bg-gray-50 px-3 py-2 text-sm font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
            <p className="text-xs text-gray-400">
              CSS das auf den Sprachauswähler oder deine Website angewendet wird.
            </p>
          </div>

          <div className="flex justify-end pt-1">
            <Button className="bg-indigo-600 hover:bg-indigo-700 h-8 px-4 text-sm">
              Speichern
            </Button>
          </div>
        </div>
      </section>

      {/* Languages appearance */}
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          Sprachdarstellung
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          Verschiebe Sprachen per Drag & Drop, um ihre Reihenfolge im Sprachauswähler
          zu ändern. Du kannst auch die Flagge und den Namen jeder Sprache anpassen.
        </p>

        <div className="border border-gray-100 rounded-lg overflow-hidden">
          {/* Original language */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <GripVertical className="h-4 w-4 text-gray-300" />
              <span className="text-lg">{LANG_FLAGS[project.originalLang] ?? "🏳️"}</span>
              <span className="text-sm font-medium text-gray-700">
                {LANG_NAMES[project.originalLang] ?? project.originalLang.toUpperCase()}
              </span>
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                Original
              </span>
            </div>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              <Edit2 className="h-3.5 w-3.5 text-gray-400" />
            </Button>
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
                <GripVertical className="h-4 w-4 text-gray-300 cursor-grab" />
                <span className="text-lg">{LANG_FLAGS[lang.langCode] ?? "🏳️"}</span>
                <span className="text-sm text-gray-700">
                  {LANG_NAMES[lang.langCode] ?? lang.langCode.toUpperCase()}
                </span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <Edit2 className="h-3.5 w-3.5 text-gray-400" />
              </Button>
            </div>
          ))}

          {project.languages.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              Noch keine Übersetzungssprachen konfiguriert.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
