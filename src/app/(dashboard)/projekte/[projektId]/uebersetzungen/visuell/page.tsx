import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Paintbrush } from "lucide-react";
import Link from "next/link";
import { getRequestLocale } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";
import { VisualEditorLauncher } from "@/components/projekte/visual-editor-launcher";
import { uiText } from "@/lib/static-copy";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function VisuellerEditorPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { languages: true },
  });

  if (!project) notFound();

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">
        {uiText(locale, "Visual editor", "Visueller Editor")}
      </h2>

      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center max-w-lg mx-auto">
        <div className="h-16 w-16 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-4">
          <Paintbrush className="h-8 w-8 text-indigo-600" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          {uiText(locale, "Edit translations directly on your website", "Übersetzungen direkt auf deiner Website bearbeiten")}
        </h3>
        <p className="text-gray-500 text-sm mb-6">
          {uiText(locale, "Use the visual editor to change translations directly in the context of your website. Click any text to translate it.", "Mit dem visuellen Editor kannst du Übersetzungen direkt im Kontext deiner Website bearbeiten. Klicke auf einen Text um ihn zu übersetzen.")}
        </p>
        <div className="space-y-3">
          <VisualEditorLauncher
            projectId={projektId}
            languages={project.languages}
          />
          <Button asChild variant="outline">
            <Link href={withLocalePrefix(`/projects/${projektId}/settings/setup`, locale)}>
              {uiText(locale, "Open setup", "Setup öffnen")}
            </Link>
          </Button>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          {locale === "de"
            ? `Öffnet ${project.domain} mit einem kurzlebigen Editor-Token`
            : `Opens ${project.domain} in the Deepglot visual editor`}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          {uiText(locale, "The editor launches for one active target language and is verified by the plugin before booting.", "Der Editor wird für eine aktive Zielsprache gestartet und vom Plugin vor dem Booten verifiziert.")}
        </p>

        {/* Feature preview */}
        <div className="mt-8 border border-gray-100 rounded-lg p-4 text-left">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            {uiText(locale, "Available features", "Verfügbare Funktionen")}
          </p>
          <ul className="space-y-2 text-sm text-gray-600">
            {[
              uiText(locale, "Click text directly on the page and translate it", "Texte direkt auf der Seite anklicken und übersetzen"),
              uiText(locale, "Accept AI suggestions or refine them manually", "KI-Vorschläge akzeptieren oder manuell anpassen"),
              uiText(locale, "See changes live right away", "Änderungen sofort live sehen"),
              uiText(locale, "Save translations to the database automatically", "Übersetzungen automatisch in der Datenbank speichern"),
            ].map((feature) => (
              <li key={feature} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 flex-shrink-0" />
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
