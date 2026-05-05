import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CreateApiKeyDialog } from "@/components/projekte/create-api-key-dialog";
import { ExternalLink, Key, Plus } from "lucide-react";
import Link from "next/link";
import { requireProjectManagement } from "@/lib/project-page-access";
import { getRequestLocale } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function SetupPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();
  await requireProjectManagement(projektId);

  const project = await db.project.findUnique({ where: { id: projektId } });
  if (!project) notFound();

  // Get the first active API key for display
  const apiKey = await db.apiKey.findFirst({
    where: { projectId: projektId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  const pluginSourceUrl =
    "https://github.com/ostheimer/deepglot/tree/main/wordpress-plugin/deepglot";

  return (
    <div className="max-w-2xl space-y-5">
      <h2 className="text-xl font-bold text-gray-900">
        {locale === "de" ? "Setup" : "Setup"}
      </h2>

      {/* API Key section */}
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <Key className="h-4 w-4 text-indigo-600" />
          API-Key
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          {locale === "de"
            ? "Verwende diesen API-Key, um Deepglot in deine Website zu integrieren."
            : "Use this API key to integrate Deepglot into your website."}
        </p>

        {apiKey ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 font-mono text-sm text-gray-800 select-all">
                {apiKey.keyPrefix}••••••••••••••••••••••••••••••••
              </div>
              <CreateApiKeyDialog
                projectId={projektId}
                label={locale === "de" ? "Neuen Schlüssel erstellen" : "Create new key"}
                variant="outline"
              />
            </div>
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {locale === "de"
                ? "⚠️ Der vollständige API-Key wird nur einmal beim Erstellen angezeigt. Wenn du ihn verloren hast, erstelle einen neuen."
                : "⚠️ The full API key is shown only once when it is created. If you lose it, create a new one."}
            </p>
          </div>
        ) : (
          <div className="text-center py-6 border border-dashed border-gray-200 rounded-lg">
            <p className="text-sm text-gray-500 mb-3">
              {locale === "de" ? "Noch kein API-Key vorhanden." : "No API key yet."}
            </p>
            <div className="flex items-center justify-center gap-3">
              <CreateApiKeyDialog
                projectId={projektId}
                label={locale === "de" ? "API-Key erstellen" : "Create API key"}
              />
              <Button asChild variant="outline" size="sm">
                <Link href={withLocalePrefix(`/projects/${projektId}/api-keys`, locale)}>
                  <Plus className="mr-2 h-4 w-4" />
                  {locale === "de" ? "Zur Verwaltung" : "Open manager"}
                </Link>
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Installation guide */}
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">
          {locale === "de" ? "WordPress Plugin einrichten" : "Set up the WordPress plugin"}
        </h3>
        <ol className="space-y-4">
          {[
            {
              step: 1,
              title: locale === "de" ? "Plugin herunterladen" : "Download plugin",
              desc: locale === "de"
                ? "Der Plugin-Quellcode ist im Deepglot-Repository verfügbar. Ein gebautes Installer-ZIP wird noch nicht automatisch bereitgestellt."
                : "The plugin source is available in the Deepglot repository. A built installer ZIP is not published automatically yet.",
              action: (
                <Button asChild variant="outline" size="sm">
                  <Link href={pluginSourceUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {locale === "de" ? "Plugin-Quelle öffnen" : "Open plugin source"}
                  </Link>
                </Button>
              ),
            },
            {
              step: 2,
              title: locale === "de" ? "Plugin aktivieren" : "Activate plugin",
              desc: locale === "de"
                ? "Gehe in WordPress zu Plugins → Installierte Plugins und aktiviere Deepglot."
                : "Open Plugins → Installed Plugins in WordPress and activate Deepglot.",
            },
            {
              step: 3,
              title: locale === "de" ? "API-Key eintragen" : "Add API key",
              desc: locale === "de"
                ? "Navigiere zu Einstellungen → Deepglot und trage deinen API-Key ein."
                : "Navigate to Settings → Deepglot and add your API key.",
            },
            {
              step: 4,
              title: locale === "de" ? "Sprachen konfigurieren" : "Configure languages",
              desc: locale === "de"
                ? "Wähle die Zielsprachen aus und speichere die Einstellungen. Deine Website wird automatisch übersetzt."
                : "Choose target languages and save your settings. Your website will be translated automatically.",
            },
          ].map((item) => (
            <li key={item.step} className="flex gap-4">
              <span className="flex-shrink-0 h-7 w-7 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center">
                {item.step}
              </span>
              <div className="pt-0.5">
                <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                <p className="text-sm text-gray-500 mt-0.5">{item.desc}</p>
                {"action" in item && <div className="mt-2">{item.action}</div>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Code snippet */}
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-3">
          {locale === "de" ? "Manuelle Integration (ohne WordPress)" : "Manual integration (without WordPress)"}
        </h3>
        <p className="text-sm text-gray-500 mb-3">
          {locale === "de" ? "Für andere Plattformen: Füge dieses Script in den" : "For other platforms, add this script to the"}{" "}
          <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">&lt;head&gt;</code>{" "}
          {locale === "de" ? "deiner Website ein." : "of your website."}
        </p>
        <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto">
          <code>{`<script>
  window.DEEPGLOT_KEY = "${apiKey?.keyPrefix ?? "dg_live_..."}...";
  window.DEEPGLOT_LANGS = ["en", "fr"];
</script>
<script async src="https://cdn.deepglot.com/v1/deepglot.js"></script>`}</code>
        </pre>
      </section>
    </div>
  );
}
