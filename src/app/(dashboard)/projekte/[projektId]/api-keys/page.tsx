import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Key } from "lucide-react";
import { format } from "date-fns";
import { getRequestLocale } from "@/lib/request-locale";
import { getDateFnsLocale } from "@/lib/locale-formatting";
import { CreateApiKeyDialog } from "@/components/projekte/create-api-key-dialog";
import { DeleteApiKeyButton } from "@/components/projekte/delete-api-key-button";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function ApiKeysPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();

  const project = await db.project.findUnique({ where: { id: projektId } });
  if (!project) notFound();

  const apiKeys = await db.apiKey.findMany({
    where: { projectId: projektId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            {locale === "de" ? "API-Keys" : "API keys"}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {locale === "de"
              ? "API-Keys verbinden dein WordPress-Plugin mit Deepglot"
              : "API keys connect your WordPress plugin to Deepglot"}
          </p>
        </div>
        <CreateApiKeyDialog
          projectId={projektId}
          label={locale === "de" ? "Neuen API-Key erstellen" : "Create new API key"}
        />
      </div>

      {apiKeys.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <div className="h-12 w-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <Key className="h-6 w-6 text-gray-400" />
            </div>
            <h3 className="font-medium text-gray-900 mb-2">
              {locale === "de" ? "Noch kein API-Key" : "No API key yet"}
            </h3>
            <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
              {locale === "de"
                ? "Erstelle einen API-Key und trage ihn in deinem WordPress-Plugin ein."
                : "Create an API key and add it to your WordPress plugin."}
            </p>
            <CreateApiKeyDialog
              projectId={projektId}
              label={locale === "de" ? "Ersten API-Key erstellen" : "Create first API key"}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[2fr_1.8fr_1fr_1fr_auto] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">NAME</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">KEY</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {locale === "de" ? "ERSTELLT" : "CREATED"}
            </span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {locale === "de" ? "ZULETZT GENUTZT" : "LAST USED"}
            </span>
            <span></span>
          </div>

          {apiKeys.map((apiKey) => (
            <div
              key={apiKey.id}
              className="grid grid-cols-[2fr_1.8fr_1fr_1fr_auto] gap-4 px-6 py-4 border-b border-gray-100 last:border-0 items-center hover:bg-gray-50"
            >
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900">{apiKey.name}</p>
                {!apiKey.isActive && (
                  <Badge variant="outline" className="text-xs text-gray-400">
                    {locale === "de" ? "Inaktiv" : "Inactive"}
                  </Badge>
                )}
              </div>

              <div className="space-y-1">
                <code className="inline-flex text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-700">
                  {apiKey.keyPrefix}••••••••
                </code>
                <p className="text-xs text-gray-400">
                  {locale === "de"
                    ? "Vollstaendiger Schluessel war nur bei der Erstellung sichtbar."
                    : "The full key was visible only when it was created."}
                </p>
              </div>

              <span className="text-sm text-gray-500">
                {format(apiKey.createdAt, locale === "de" ? "dd.MM.yyyy" : "MM/dd/yyyy", {
                  locale: getDateFnsLocale(locale),
                })}
              </span>

              <span className="text-sm text-gray-500">
                {apiKey.lastUsedAt
                  ? format(apiKey.lastUsedAt, locale === "de" ? "dd.MM.yyyy" : "MM/dd/yyyy", {
                      locale: getDateFnsLocale(locale),
                    })
                  : locale === "de"
                    ? "Noch nie"
                    : "Never"}
              </span>

              <DeleteApiKeyButton apiKeyId={apiKey.id} projectId={projektId} />
            </div>
          ))}
        </div>
      )}

      {/* Setup Instructions */}
      <Card className="mt-6 bg-gray-50 border-gray-200">
        <CardContent className="py-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            {locale === "de" ? "WordPress Plugin einrichten" : "Set up the WordPress plugin"}
          </h3>
          <ol className="space-y-2 text-sm text-gray-600">
            <li className="flex gap-2">
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">1</span>
              {locale === "de"
                ? "Plugin von WordPress.org herunterladen und installieren"
                : "Download and install the plugin from WordPress.org"}
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">2</span>
              {locale === "de" ? "In WordPress: Einstellungen → Deepglot" : "In WordPress: Settings → Deepglot"}
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">3</span>
              {locale === "de" ? "API-Key eintragen und Sprachen konfigurieren" : "Add the API key and configure languages"}
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
