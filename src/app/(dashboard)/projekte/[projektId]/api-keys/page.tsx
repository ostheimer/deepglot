import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Key } from "lucide-react";
import { format } from "date-fns";
import { getRequestLocale } from "@/lib/request-locale";
import { getDateFnsLocale } from "@/lib/locale-formatting";
import { requireProjectManagement } from "@/lib/project-page-access";
import { CreateApiKeyDialog } from "@/components/projekte/create-api-key-dialog";
import { DeleteApiKeyButton } from "@/components/projekte/delete-api-key-button";
import { NewApiKeyBanner } from "@/components/projekte/new-api-key-banner";
import { uiText } from "@/lib/static-copy";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function ApiKeysPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();
  await requireProjectManagement(projektId);

  const project = await db.project.findUnique({ where: { id: projektId } });
  if (!project) notFound();

  const apiKeys = await db.apiKey.findMany({
    where: { projectId: projektId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <NewApiKeyBanner projectId={projektId} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            {uiText(locale, "API keys", "API-Keys")}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {uiText(locale, "API keys connect your WordPress plugin to Deepglot", "API-Keys verbinden dein WordPress-Plugin mit Deepglot")}
          </p>
        </div>
        <CreateApiKeyDialog
          projectId={projektId}
          label={uiText(locale, "Create new API key", "Neuen API-Key erstellen")}
        />
      </div>

      {apiKeys.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <div className="h-12 w-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <Key className="h-6 w-6 text-gray-400" />
            </div>
            <h3 className="font-medium text-gray-900 mb-2">
              {uiText(locale, "No API key yet", "Noch kein API-Key")}
            </h3>
            <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
              {uiText(locale, "Create an API key and add it to your WordPress plugin.", "Erstelle einen API-Key und trage ihn in deinem WordPress-Plugin ein.")}
            </p>
            <CreateApiKeyDialog
              projectId={projektId}
              label={uiText(locale, "Create first API key", "Ersten API-Key erstellen")}
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
              {uiText(locale, "LAST USED", "ZULETZT GENUTZT")}
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
                    {uiText(locale, "Inactive", "Inaktiv")}
                  </Badge>
                )}
              </div>

              <div className="space-y-1">
                <code className="inline-flex text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-700">
                  {apiKey.keyPrefix}••••••••
                </code>
                <p className="text-xs text-gray-400">
                  {uiText(locale, "The full key was visible only when it was created.", "Vollständiger Schlüssel war nur bei der Erstellung sichtbar.")}
                </p>
              </div>

              <span className="text-sm text-gray-500">
                {format(apiKey.createdAt, uiText(locale, "MM/dd/yyyy", "dd.MM.yyyy"), {
                  locale: getDateFnsLocale(locale),
                })}
              </span>

              <span className="text-sm text-gray-500">
                {apiKey.lastUsedAt
                  ? format(apiKey.lastUsedAt, uiText(locale, "MM/dd/yyyy", "dd.MM.yyyy"), {
                      locale: getDateFnsLocale(locale),
                    })
                  : uiText(locale, "Never", "Noch nie")}
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
            {uiText(locale, "Set up the WordPress plugin", "WordPress Plugin einrichten")}
          </h3>
          <ol className="space-y-2 text-sm text-gray-600">
            <li className="flex gap-2">
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">1</span>
              {uiText(locale, "Download and install the plugin from WordPress.org", "Plugin von WordPress.org herunterladen und installieren")}
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">2</span>
              {uiText(locale, "In WordPress: Settings → Deepglot", "In WordPress: Einstellungen → Deepglot")}
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">3</span>
              {uiText(locale, "Add the API key and configure languages", "API-Key eintragen und Sprachen konfigurieren")}
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
