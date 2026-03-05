import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SettingsToggle } from "@/components/projekte/settings-toggle";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function WordPressSettingsPage({ params }: PageProps) {
  const { projektId } = await params;

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { settings: true },
  });
  if (!project) notFound();

  const s = project.settings;

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-bold text-gray-900 mb-6">WordPress-Einstellungen</h2>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <SettingsToggle
          label="E-Mails über wp_mail übersetzen"
          description="Aktiviere diese Option, um alle E-Mails zu übersetzen, die die wp_mail-Funktion verwenden."
          defaultChecked={s?.translateEmails ?? false}
        />
        <div className="border-t border-gray-100">
          <SettingsToggle
            label="Suche in der Besuchersprache"
            description="Ermöglicht Besuchern, in der Sprache zu suchen, die sie verwenden."
            defaultChecked={s?.translateSearch ?? false}
          />
        </div>
        <div className="border-t border-gray-100">
          <SettingsToggle
            label="AMP-Seiten übersetzen"
            description="Übersetze AMP-Seiten (Accelerated Mobile Pages)."
            defaultChecked={s?.translateAmp ?? false}
          />
        </div>

        <div className="flex justify-end p-4 border-t border-gray-100">
          <Button className="bg-indigo-600 hover:bg-indigo-700 h-8 px-4 text-sm">
            Speichern
          </Button>
        </div>
      </div>

      {/* Info box */}
      <div className="mt-5 bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-sm font-medium text-blue-900 mb-1">WordPress-spezifische Features</p>
        <p className="text-sm text-blue-700">
          Diese Einstellungen gelten nur für WordPress-Installationen mit dem
          Deepglot-Plugin. Stelle sicher, dass das Plugin aktiviert und konfiguriert ist.
        </p>
      </div>
    </div>
  );
}
