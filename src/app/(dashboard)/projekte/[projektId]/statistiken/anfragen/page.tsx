import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart2, TrendingUp } from "lucide-react";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function StatistikenAnfragenPage({ params }: PageProps) {
  const { projektId } = await params;

  const project = await db.project.findUnique({ where: { id: projektId } });
  if (!project) notFound();

  // Get last 6 months of usage
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return parseInt(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
  }).reverse();

  const usageByMonth = await db.usageRecord.groupBy({
    by: ["month"],
    where: { projectId: projektId, month: { in: months } },
    _sum: { words: true },
  });

  const usageMap = Object.fromEntries(
    usageByMonth.map((r) => [r.month, r._sum.words ?? 0])
  );

  const totalTranslations = await db.translation.count({
    where: { projectId: projektId },
  });

  const totalUrls = await db.translatedUrl.count({
    where: { projectId: projektId },
  });

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">Übersetzungsanfragen</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <BarChart2 className="h-4 w-4" />
              Gespeicherte Strings
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
              <TrendingUp className="h-4 w-4" />
              Übersetzte URLs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-gray-900">
              {totalUrls.toLocaleString("de-DE")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Wörter diesen Monat
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-gray-900">
              {(usageMap[months[months.length - 1]] ?? 0).toLocaleString("de-DE")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly chart (simplified bar visualization) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monatlicher Verlauf (Wörter)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 h-40">
            {months.map((month) => {
              const words = usageMap[month] ?? 0;
              const maxWords = Math.max(...months.map((m) => usageMap[m] ?? 0), 1);
              const heightPercent = (words / maxWords) * 100;
              const monthStr = String(month);
              const label = `${monthStr.slice(4, 6)}/${monthStr.slice(2, 4)}`;

              return (
                <div key={month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-gray-500">
                    {words > 0 ? words.toLocaleString("de-DE") : ""}
                  </span>
                  <div className="w-full flex items-end" style={{ height: "100px" }}>
                    <div
                      className="w-full bg-indigo-500 rounded-t transition-all"
                      style={{
                        height: `${Math.max(heightPercent, words > 0 ? 5 : 2)}%`,
                        opacity: heightPercent === 0 ? 0.2 : 1,
                      }}
                    />
                  </div>
                  <span className="text-xs text-gray-500">{label}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
