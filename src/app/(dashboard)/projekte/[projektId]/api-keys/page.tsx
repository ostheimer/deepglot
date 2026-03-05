import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Key, Plus, Copy, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function ApiKeysPage({ params }: PageProps) {
  const { projektId } = await params;

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
          <h2 className="text-xl font-bold text-gray-900">API-Keys</h2>
          <p className="text-sm text-gray-500 mt-1">
            API-Keys verbinden dein WordPress-Plugin mit Deepglot
          </p>
        </div>
        <Button className="bg-indigo-600 hover:bg-indigo-700" size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Neuen API-Key erstellen
        </Button>
      </div>

      {apiKeys.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <div className="h-12 w-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <Key className="h-6 w-6 text-gray-400" />
            </div>
            <h3 className="font-medium text-gray-900 mb-2">Noch kein API-Key</h3>
            <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
              Erstelle einen API-Key und trage ihn in deinem WordPress-Plugin ein.
            </p>
            <Button className="bg-indigo-600 hover:bg-indigo-700">
              <Plus className="mr-2 h-4 w-4" />
              Ersten API-Key erstellen
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_auto] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">NAME</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">KEY</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">ERSTELLT</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">ZULETZT GENUTZT</span>
            <span></span>
          </div>

          {apiKeys.map((apiKey) => (
            <div
              key={apiKey.id}
              className="grid grid-cols-[2fr_1.5fr_1fr_1fr_auto] gap-4 px-6 py-4 border-b border-gray-100 last:border-0 items-center hover:bg-gray-50"
            >
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900">{apiKey.name}</p>
                {!apiKey.isActive && (
                  <Badge variant="outline" className="text-xs text-gray-400">Inaktiv</Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <code className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-700">
                  {apiKey.keyPrefix}••••••••
                </code>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <Copy className="h-3 w-3 text-gray-400" />
                </Button>
              </div>

              <span className="text-sm text-gray-500">
                {format(apiKey.createdAt, "dd.MM.yyyy", { locale: de })}
              </span>

              <span className="text-sm text-gray-500">
                {apiKey.lastUsedAt
                  ? format(apiKey.lastUsedAt, "dd.MM.yyyy", { locale: de })
                  : "Noch nie"}
              </span>

              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Setup Instructions */}
      <Card className="mt-6 bg-gray-50 border-gray-200">
        <CardContent className="py-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            WordPress Plugin einrichten
          </h3>
          <ol className="space-y-2 text-sm text-gray-600">
            <li className="flex gap-2">
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">1</span>
              Plugin von WordPress.org herunterladen und installieren
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">2</span>
              In WordPress: Einstellungen → Deepglot
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">3</span>
              API-Key eintragen und Sprachen konfigurieren
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
