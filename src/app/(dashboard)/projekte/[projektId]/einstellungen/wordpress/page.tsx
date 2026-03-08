import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SettingsToggle } from "@/components/projekte/settings-toggle";
import { getRequestLocale } from "@/lib/request-locale";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function WordPressSettingsPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { settings: true },
  });
  if (!project) notFound();

  const s = project.settings;

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-bold text-gray-900 mb-6">
        {locale === "de" ? "WordPress-Einstellungen" : "WordPress settings"}
      </h2>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <SettingsToggle
          label={locale === "de" ? "E-Mails über wp_mail übersetzen" : "Translate emails sent via wp_mail"}
          description={locale === "de"
            ? "Aktiviere diese Option, um alle E-Mails zu übersetzen, die die wp_mail-Funktion verwenden."
            : "Enable this option to translate all emails sent with the wp_mail function."}
          defaultChecked={s?.translateEmails ?? false}
        />
        <div className="border-t border-gray-100">
          <SettingsToggle
            label={locale === "de" ? "Suche in der Besuchersprache" : "Search in the visitor language"}
            description={locale === "de"
              ? "Ermöglicht Besuchern, in der Sprache zu suchen, die sie verwenden."
              : "Lets visitors search in the language they are using."}
            defaultChecked={s?.translateSearch ?? false}
          />
        </div>
        <div className="border-t border-gray-100">
          <SettingsToggle
            label={locale === "de" ? "AMP-Seiten übersetzen" : "Translate AMP pages"}
            description={locale === "de" ? "Übersetze AMP-Seiten (Accelerated Mobile Pages)." : "Translate AMP pages (Accelerated Mobile Pages)."}
            defaultChecked={s?.translateAmp ?? false}
          />
        </div>

        <div className="flex justify-end p-4 border-t border-gray-100">
          <Button className="bg-indigo-600 hover:bg-indigo-700 h-8 px-4 text-sm">
            {locale === "de" ? "Speichern" : "Save"}
          </Button>
        </div>
      </div>

      {/* Info box */}
      <div className="mt-5 bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-sm font-medium text-blue-900 mb-1">
          {locale === "de" ? "WordPress-spezifische Features" : "WordPress-specific features"}
        </p>
        <p className="text-sm text-blue-700">
          {locale === "de"
            ? "Diese Einstellungen gelten nur für WordPress-Installationen mit dem Deepglot-Plugin. Stelle sicher, dass das Plugin aktiviert und konfiguriert ist."
            : "These settings apply only to WordPress installations using the Deepglot plugin. Make sure the plugin is active and configured."}
        </p>
      </div>
    </div>
  );
}
