import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CopyApiKeyButton } from "@/components/projekte/copy-api-key-button";
import { Plus, Key } from "lucide-react";
import Link from "next/link";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function SetupPage({ params }: PageProps) {
  const { projektId } = await params;

  const project = await db.project.findUnique({ where: { id: projektId } });
  if (!project) notFound();

  // Get the first active API key for display
  const apiKey = await db.apiKey.findFirst({
    where: { projectId: projektId, isActive: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-2xl space-y-5">
      <h2 className="text-xl font-bold text-gray-900">Setup</h2>

      {/* API Key section */}
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <Key className="h-4 w-4 text-indigo-600" />
          API-Key
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          Verwende diesen API-Key, um Deepglot in deine Website zu integrieren.
        </p>

        {apiKey ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 font-mono text-sm text-gray-800 select-all">
                {apiKey.keyPrefix}••••••••••••••••••••••••••••••••
              </div>
              <CopyApiKeyButton keyPrefix={apiKey.keyPrefix} />
            </div>
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ⚠️ Der vollständige API-Key wird nur einmal beim Erstellen angezeigt.
              Wenn du ihn verloren hast, erstelle einen neuen.
            </p>
          </div>
        ) : (
          <div className="text-center py-6 border border-dashed border-gray-200 rounded-lg">
            <p className="text-sm text-gray-500 mb-3">
              Noch kein API-Key vorhanden.
            </p>
            <Link href={`/projekte/${projektId}/api-keys`}>
              <Button className="bg-indigo-600 hover:bg-indigo-700" size="sm">
                <Plus className="mr-2 h-4 w-4" />
                API-Key erstellen
              </Button>
            </Link>
          </div>
        )}
      </section>

      {/* Installation guide */}
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">
          WordPress Plugin einrichten
        </h3>
        <ol className="space-y-4">
          {[
            {
              step: 1,
              title: "Plugin herunterladen",
              desc: "Lade das Deepglot WordPress Plugin herunter und installiere es in deinem WordPress-Backend.",
              action: <Button variant="outline" size="sm">Plugin herunterladen</Button>,
            },
            {
              step: 2,
              title: "Plugin aktivieren",
              desc: "Gehe in WordPress zu Plugins → Installierte Plugins und aktiviere Deepglot.",
            },
            {
              step: 3,
              title: "API-Key eintragen",
              desc: "Navigiere zu Einstellungen → Deepglot und trage deinen API-Key ein.",
            },
            {
              step: 4,
              title: "Sprachen konfigurieren",
              desc: "Wähle die Zielsprachen aus und speichere die Einstellungen. Deine Website wird automatisch übersetzt.",
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
          Manuelle Integration (ohne WordPress)
        </h3>
        <p className="text-sm text-gray-500 mb-3">
          Für andere Plattformen: Füge dieses Script in den{" "}
          <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">&lt;head&gt;</code> deiner Website ein.
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
