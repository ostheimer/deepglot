import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, Languages, Key, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await auth();

  // Load user's organizations and projects
  const memberships = await db.organizationMember.findMany({
    where: { userId: session?.user?.id ?? "" },
    include: {
      organization: {
        include: {
          projects: {
            include: { languages: true },
          },
          subscription: true,
          _count: { select: { usageRecords: true } },
        },
      },
    },
    take: 1, // first org for now
  });

  const org = memberships[0]?.organization;
  const currentMonth = parseInt(new Date().toISOString().slice(0, 7).replace("-", ""));

  const monthlyUsage = org
    ? await db.usageRecord.aggregate({
        where: { organizationId: org.id, month: currentMonth },
        _sum: { words: true },
      })
    : null;

  const wordsUsed = monthlyUsage?._sum.words ?? 0;
  const wordsLimit = org?.subscription?.wordsLimit ?? 10_000;
  const usagePercent = Math.min(Math.round((wordsUsed / wordsLimit) * 100), 100);

  const totalTranslations = org
    ? await db.translation.count({ where: { project: { organizationId: org.id } } })
    : 0;

  const totalApiKeys = org
    ? await db.apiKey.count({ where: { project: { organizationId: org.id } } })
    : 0;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Willkommen zurück{session?.user?.name ? `, ${session.user.name}` : ""}!
        </h1>
        <p className="text-gray-600 mt-1">
          Hier ist eine Übersicht deiner Deepglot-Aktivitäten.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Projekte
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-gray-900">{org?.projects.length ?? 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Languages className="h-4 w-4" />
              Gespeicherte Übersetzungen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-gray-900">
              {totalTranslations.toLocaleString("de-DE")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Key className="h-4 w-4" />
              Aktive API-Keys
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-gray-900">{totalApiKeys}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Wörter diesen Monat
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-gray-900">
              {wordsUsed.toLocaleString("de-DE")}
            </p>
            <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  usagePercent > 90 ? "bg-red-500" : usagePercent > 70 ? "bg-yellow-500" : "bg-indigo-600"
                }`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {wordsUsed.toLocaleString("de-DE")} / {wordsLimit.toLocaleString("de-DE")} Wörter ({usagePercent}%)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Plan Banner */}
      <Card className="mb-8 border-indigo-100 bg-indigo-50">
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <p className="font-medium text-indigo-900">
              Aktueller Plan:{" "}
              <Badge className="bg-indigo-600 text-white ml-1">
                {org?.plan ?? "FREE"}
              </Badge>
            </p>
            <p className="text-sm text-indigo-700 mt-0.5">
              {(wordsLimit - wordsUsed).toLocaleString("de-DE")} Wörter verbleiben diesen Monat
            </p>
          </div>
          <Link href="/abonnement">
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700">
              Plan upgraden
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Recent Projects */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Deine Projekte</h2>
          <Link href="/projekte">
            <Button variant="ghost" size="sm">Alle ansehen</Button>
          </Link>
        </div>
        {org?.projects.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {org.projects.slice(0, 6).map((project) => (
              <Link key={project.id} href={`/projekte/${project.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{project.name}</p>
                        <p className="text-sm text-gray-500 mt-0.5">{project.domain}</p>
                      </div>
                      <Globe className="h-4 w-4 text-gray-400 mt-0.5" />
                    </div>
                    <div className="flex gap-1.5 mt-3 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        {project.originalLang.toUpperCase()}
                      </Badge>
                      {project.languages.map((lang) => (
                        <Badge key={lang.id} variant="outline" className="text-xs">
                          {lang.langCode.toUpperCase()}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <Globe className="h-10 w-10 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">Noch kein Projekt</p>
              <p className="text-sm text-gray-500 mt-1 mb-4">
                Erstelle dein erstes Projekt und verbinde dein WordPress-Plugin.
              </p>
              <Link href="/projekte/neu">
                <Button className="bg-indigo-600 hover:bg-indigo-700">
                  Erstes Projekt erstellen
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
