import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Paintbrush, ExternalLink } from "lucide-react";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function VisuellerEditorPage({ params }: PageProps) {
  const { projektId } = await params;

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { languages: true },
  });

  if (!project) notFound();

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">Visueller Editor</h2>

      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center max-w-lg mx-auto">
        <div className="h-16 w-16 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-4">
          <Paintbrush className="h-8 w-8 text-indigo-600" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Übersetzungen direkt auf deiner Website bearbeiten
        </h3>
        <p className="text-gray-500 text-sm mb-6">
          Mit dem visuellen Editor kannst du Übersetzungen direkt im Kontext
          deiner Website bearbeiten. Klicke auf einen Text um ihn zu übersetzen.
        </p>
        <Button
          className="bg-indigo-600 hover:bg-indigo-700"
          onClick={() => {}}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Bearbeitung starten
        </Button>
        <p className="text-xs text-gray-400 mt-3">
          Öffnet {project.domain} mit dem Deepglot Visual Editor
        </p>

        {/* Feature preview */}
        <div className="mt-8 border border-gray-100 rounded-lg p-4 text-left">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Verfügbare Funktionen
          </p>
          <ul className="space-y-2 text-sm text-gray-600">
            {[
              "Texte direkt auf der Seite anklicken und übersetzen",
              "KI-Vorschläge akzeptieren oder manuell anpassen",
              "Änderungen sofort live sehen",
              "Übersetzungen automatisch in der Datenbank speichern",
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
