import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Paintbrush, ExternalLink } from "lucide-react";
import Link from "next/link";
import { getRequestLocale } from "@/lib/request-locale";
import { getVisualEditorUrl } from "@/lib/project-url";
import { withLocalePrefix } from "@/lib/site-locale";

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
  const editorUrl = getVisualEditorUrl(project.domain);

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">
        {locale === "de" ? "Visueller Editor" : "Visual editor"}
      </h2>

      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center max-w-lg mx-auto">
        <div className="h-16 w-16 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-4">
          <Paintbrush className="h-8 w-8 text-indigo-600" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          {locale === "de"
            ? "Übersetzungen direkt auf deiner Website bearbeiten"
            : "Edit translations directly on your website"}
        </h3>
        <p className="text-gray-500 text-sm mb-6">
          {locale === "de"
            ? "Mit dem visuellen Editor kannst du Übersetzungen direkt im Kontext deiner Website bearbeiten. Klicke auf einen Text um ihn zu übersetzen."
            : "Use the visual editor to change translations directly in the context of your website. Click any text to translate it."}
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button asChild className="bg-indigo-600 hover:bg-indigo-700">
            <a href={editorUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              {locale === "de" ? "Bearbeitung starten" : "Start editing"}
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link href={withLocalePrefix(`/projects/${projektId}/settings/setup`, locale)}>
              {locale === "de" ? "Setup oeffnen" : "Open setup"}
            </Link>
          </Button>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          {locale === "de"
            ? `Öffnet ${project.domain} mit dem Deepglot Visual Editor`
            : `Opens ${project.domain} in the Deepglot visual editor`}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          {locale === "de"
            ? "Der Editor startet direkt auf der Zielseite mit einem Editor-Parameter in der URL."
            : "The editor opens the target site directly with an editor query parameter in the URL."}
        </p>

        {/* Feature preview */}
        <div className="mt-8 border border-gray-100 rounded-lg p-4 text-left">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            {locale === "de" ? "Verfügbare Funktionen" : "Available features"}
          </p>
          <ul className="space-y-2 text-sm text-gray-600">
            {[
              locale === "de"
                ? "Texte direkt auf der Seite anklicken und übersetzen"
                : "Click text directly on the page and translate it",
              locale === "de"
                ? "KI-Vorschläge akzeptieren oder manuell anpassen"
                : "Accept AI suggestions or refine them manually",
              locale === "de"
                ? "Änderungen sofort live sehen"
                : "See changes live right away",
              locale === "de"
                ? "Übersetzungen automatisch in der Datenbank speichern"
                : "Save translations to the database automatically",
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
