import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye } from "lucide-react";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function SeitenaufrufeStatistikPage({ params }: PageProps) {
  const { projektId } = await params;

  const project = await db.project.findUnique({ where: { id: projektId } });
  if (!project) notFound();

  const topUrls = await db.translatedUrl.findMany({
    where: { projectId: projektId },
    orderBy: { requestCount: "desc" },
    take: 10,
  });

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">Seitenaufrufe</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4 text-indigo-600" />
            Meistaufgerufene Seiten
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topUrls.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              Noch keine Seitenaufruf-Daten vorhanden.
              Das Plugin sendet Daten beim ersten Seitenaufruf.
            </p>
          ) : (
            <div className="space-y-3">
              {topUrls.map((url) => (
                <div key={url.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <span className="text-sm font-mono text-gray-700">{url.urlPath}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">{url.langTo.toUpperCase()}</span>
                    <span className="text-sm font-semibold text-gray-900">
                      {url.requestCount.toLocaleString("de-DE")} Aufrufe
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
