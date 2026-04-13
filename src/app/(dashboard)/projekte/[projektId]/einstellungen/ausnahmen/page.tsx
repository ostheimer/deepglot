import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus, Edit2, Trash2 } from "lucide-react";
import { getRequestLocale } from "@/lib/request-locale";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

const EXCLUSION_RULE_LABELS: Record<string, string> = {
  URL: "Contains",
  REGEX: "Matches regex",
  CSS_CLASS: "CSS class",
  CSS_ID: "CSS ID",
};

export default async function AusnahmenPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();

  const project = await db.project.findUnique({ where: { id: projektId } });
  if (!project) notFound();

  const exclusions = await db.translationExclusion.findMany({
    where: { projectId: projektId },
    orderBy: { createdAt: "asc" },
  });

  const urlExclusions = exclusions.filter((e) => e.type === "URL" || e.type === "REGEX");
  const blockExclusions = exclusions.filter((e) => e.type === "CSS_CLASS" || e.type === "CSS_ID");

  return (
    <div className="max-w-4xl space-y-8">
      {/* Excluded URLs */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            {locale === "de" ? "Ausgeschlossene URLs" : "Excluded URLs"}
            <button className="text-gray-400 hover:text-gray-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <Input placeholder={locale === "de" ? "URLs suchen..." : "Search URLs..."} className="pl-9 h-8 w-52 text-sm" />
            </div>
            <select className="h-8 text-sm border border-gray-200 rounded-md px-2 bg-white">
              <option>{locale === "de" ? "Alle" : "All"}</option>
              <option>URL</option>
              <option>Regex</option>
            </select>
            <Button variant="outline" size="sm" className="h-8 text-sm">
              {locale === "de" ? "Aktionen" : "Actions"} ▾
            </Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700 h-8 text-sm gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              {locale === "de" ? "Regel hinzufügen" : "Add rule"}
            </Button>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {urlExclusions.length > 0 && (
            <p className="px-5 py-3 text-sm text-gray-500 border-b border-gray-100">
              {urlExclusions.length} Ergebnis{urlExclusions.length > 1 ? "se" : ""}
            </p>
          )}

          <div className="grid grid-cols-[auto_1fr_1.5fr_1.5fr_2fr_auto] gap-4 px-5 py-2.5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider items-center">
            <input type="checkbox" className="h-3.5 w-3.5 rounded" />
            <span>Regel</span>
            <span>{locale === "de" ? "Auszuschließende URL" : "Excluded URL"}</span>
            <span>{locale === "de" ? "Sprachen" : "Languages"}</span>
            <span>{locale === "de" ? "Ausschlussverhalten" : "Exclusion behavior"}</span>
            <span>{locale === "de" ? "Aktionen" : "Actions"}</span>
          </div>

          {urlExclusions.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-gray-500">
                {locale === "de"
                  ? "Keine ausgeschlossenen URLs. Füge Regeln hinzu, um bestimmte Seiten von der Übersetzung auszunehmen."
                  : "No excluded URLs. Add rules to keep certain pages out of translation."}
              </p>
            </div>
          ) : (
            urlExclusions.map((exc) => (
              <div
                key={exc.id}
                className="grid grid-cols-[auto_1fr_1.5fr_1.5fr_2fr_auto] gap-4 px-5 py-3.5 border-b border-gray-100 last:border-0 items-center hover:bg-gray-50 group"
              >
                <input type="checkbox" className="h-3.5 w-3.5 rounded" />
                <span className="text-sm text-gray-700">
                  {EXCLUSION_RULE_LABELS[exc.type] ?? exc.type}
                </span>
                <span className="text-sm font-mono text-gray-900">{exc.value}</span>
                <span className="text-sm text-gray-400">—</span>
                <div className="text-xs text-gray-600 space-y-0.5">
                  <p>{locale === "de" ? "• Schalter ausblenden" : "• Hide switcher"}</p>
                  <p>{locale === "de" ? "• URL leitet auf Original um" : "• URL redirects to original"}</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    <Edit2 className="h-3.5 w-3.5 text-gray-400" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Excluded Blocks */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            {locale === "de" ? "Ausgeschlossene Blöcke" : "Excluded blocks"}
            <button className="text-gray-400 hover:text-gray-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <Input placeholder={locale === "de" ? "Blöcke suchen..." : "Search blocks..."} className="pl-9 h-8 w-52 text-sm" />
            </div>
            <Button variant="outline" size="sm" className="h-8 text-sm">
              {locale === "de" ? "Aktionen" : "Actions"} ▾
            </Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700 h-8 text-sm gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              {locale === "de" ? "Regel hinzufügen" : "Add rule"}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </Button>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <p className="px-5 py-3 text-sm text-gray-500 border-b border-gray-100">
            {blockExclusions.length} {locale === "de" ? "Ergebnisse" : "results"}
          </p>
          {blockExclusions.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-gray-400">
                {locale === "de"
                  ? "Keine ausgeschlossenen Blöcke. Nutze CSS-Klassen oder IDs um bestimmte HTML-Elemente von der Übersetzung auszuschließen."
                  : "No excluded blocks. Use CSS classes or IDs to exclude specific HTML elements from translation."}
              </p>
            </div>
          ) : (
            blockExclusions.map((exc) => (
              <div
                key={exc.id}
                className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-gray-100 last:border-0 hover:bg-gray-50 group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {EXCLUSION_RULE_LABELS[exc.type] ?? exc.type}
                  </p>
                  <p className="text-sm font-mono text-gray-600 truncate">{exc.value}</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    <Edit2 className="h-3.5 w-3.5 text-gray-400" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
