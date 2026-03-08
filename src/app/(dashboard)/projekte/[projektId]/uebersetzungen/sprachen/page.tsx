import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AddLanguageDialog } from "@/components/projekte/add-language-dialog";
import { Flag, Trash2, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getRequestLocale } from "@/lib/request-locale";
import { formatNumber } from "@/lib/locale-formatting";
import { getLanguageName } from "@/lib/language-names";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function SprachenPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();
  const session = await auth();

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: {
      languages: { orderBy: { langCode: "asc" } },
    },
  });

  if (!project) notFound();

  // Get word counts per language pair from the DB
  const wordCountsByLang = await db.translation.groupBy({
    by: ["langTo"],
    where: { projectId: projektId },
    _count: { id: true },
    _sum: { wordCount: true },
  });

  const manualCountsByLang = await db.translation.groupBy({
    by: ["langTo"],
    where: { projectId: projektId, isManual: true },
    _count: { id: true },
  });

  const wordCountMap = Object.fromEntries(
    wordCountsByLang.map((r) => [r.langTo, r._sum.wordCount ?? 0])
  );
  const manualCountMap = Object.fromEntries(
    manualCountsByLang.map((r) => [r.langTo, r._count.id])
  );
  const totalCountMap = Object.fromEntries(
    wordCountsByLang.map((r) => [r.langTo, r._count.id])
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">
          {locale === "de" ? "Übersetzungen nach Sprachen" : "Translations by language"}
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            {locale === "de" ? "Aktionen" : "Actions"} ▾
          </Button>
          <AddLanguageDialog
            projectId={projektId}
            originalLang={project.originalLang}
            existingLangs={project.languages.map((l) => l.langCode)}
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-[2fr_1.5fr_1.5fr_auto] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "VON / NACH" : "FROM / TO"}
          </span>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "ÜBERSETZTE WÖRTER GESAMT" : "TOTAL TRANSLATED WORDS"}
          </span>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "MANUELL ÜBERSETZT" : "MANUAL SHARE"}
          </span>
          <span></span>
        </div>

        {/* Language rows */}
        {project.languages.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Flag className="h-8 w-8 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">
              {locale === "de" ? "Noch keine Übersetzungssprachen konfiguriert." : "No translation languages configured yet."}
            </p>
          </div>
        ) : (
          project.languages.map((lang) => {
            const totalWords = wordCountMap[lang.langCode] ?? 0;
            const manualCount = manualCountMap[lang.langCode] ?? 0;
            const totalCount = totalCountMap[lang.langCode] ?? 0;
            const manualPercent =
              totalCount > 0 ? Math.round((manualCount / totalCount) * 100) : 0;

            return (
              <div
                key={lang.id}
                className="grid grid-cols-[2fr_1.5fr_1.5fr_auto] gap-4 px-6 py-4 border-b border-gray-100 last:border-0 items-center hover:bg-gray-50 transition-colors"
              >
                {/* Language pair */}
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-900">
                    {getLanguageName(project.originalLang, locale)}
                  </span>
                  <span className="text-gray-400">→</span>
                  <span className="text-sm font-medium text-gray-900">
                    {getLanguageName(lang.langCode, locale)}
                  </span>
                  {!lang.isActive && (
                    <Badge variant="outline" className="text-xs text-gray-400">
                      {locale === "de" ? "Inaktiv" : "Inactive"}
                    </Badge>
                  )}
                </div>

                {/* Total words */}
                <span className="text-sm text-gray-700 font-medium">
                  {formatNumber(totalWords, locale)}
                </span>

                {/* Manual % */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-[120px]">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all"
                      style={{ width: `${manualPercent}%` }}
                    />
                  </div>
                  <span className="text-sm text-indigo-600 font-medium min-w-[2.5rem]">
                    {manualPercent}%
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="text-xs h-7">
                    {locale === "de" ? "Optionen" : "Options"} ▾
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="text-red-600">
                        <Trash2 className="mr-2 h-4 w-4" />
                        {locale === "de" ? "Sprache entfernen" : "Remove language"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
