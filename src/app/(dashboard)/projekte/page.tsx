import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, Plus, Settings } from "lucide-react";

export const metadata = { title: "Projekte" };

export default async function ProjektePage() {
  const session = await auth();

  const memberships = await db.organizationMember.findMany({
    where: { userId: session?.user?.id ?? "" },
    include: {
      organization: {
        include: {
          projects: {
            include: {
              languages: true,
              _count: { select: { translations: true, apiKeys: true } },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
    take: 1,
  });

  const projects = memberships[0]?.organization.projects ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projekte</h1>
          <p className="text-gray-600 mt-1">
            Verwalte deine Websites und WordPress-Installationen
          </p>
        </div>
        <Link href="/projekte/neu">
          <Button className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="mr-2 h-4 w-4" />
            Neues Projekt
          </Button>
        </Link>
      </div>

      {projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Globe className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Noch kein Projekt
            </h3>
            <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
              Erstelle dein erstes Projekt, verbinde dein WordPress-Plugin und
              starte mit der Übersetzung.
            </p>
            <Link href="/projekte/neu">
              <Button className="bg-indigo-600 hover:bg-indigo-700">
                <Plus className="mr-2 h-4 w-4" />
                Erstes Projekt erstellen
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {projects.map((project) => (
            <Card
              key={project.id}
              className="hover:shadow-md transition-shadow border-gray-200"
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <Globe className="h-4 w-4 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 text-sm">
                        {project.name}
                      </h3>
                      <p className="text-xs text-gray-500">{project.domain}</p>
                    </div>
                  </div>
                  <Link href={`/projekte/${project.id}/einstellungen`}>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                      <Settings className="h-3.5 w-3.5 text-gray-400" />
                    </Button>
                  </Link>
                </div>

                {/* Language badges */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  <Badge
                    variant="secondary"
                    className="text-xs bg-gray-100 text-gray-700"
                  >
                    {project.originalLang.toUpperCase()} (Original)
                  </Badge>
                  {project.languages.map((lang) => (
                    <Badge
                      key={lang.id}
                      variant={lang.isActive ? "default" : "outline"}
                      className={`text-xs ${lang.isActive ? "bg-indigo-100 text-indigo-700 border-0" : ""}`}
                    >
                      {lang.langCode.toUpperCase()}
                    </Badge>
                  ))}
                  {project.languages.length === 0 && (
                    <span className="text-xs text-gray-400 italic">
                      Keine Übersetzungssprachen
                    </span>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-gray-50 rounded-lg p-2.5">
                    <p className="text-xs text-gray-500">Übersetzungen</p>
                    <p className="text-lg font-bold text-gray-900">
                      {project._count.translations.toLocaleString("de-DE")}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2.5">
                    <p className="text-xs text-gray-500">API-Keys</p>
                    <p className="text-lg font-bold text-gray-900">
                      {project._count.apiKeys}
                    </p>
                  </div>
                </div>

                <Link href={`/projekte/${project.id}/uebersetzungen/sprachen`}>
                  <Button
                    variant="outline"
                    className="w-full text-sm hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700"
                  >
                    Projekt öffnen
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
