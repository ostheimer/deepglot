import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BookOpen, Plus, Upload } from "lucide-react";
import { GlossaryTable } from "@/components/projekte/glossary-table";
import { getRequestLocale } from "@/lib/request-locale";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function GlossarPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { languages: true },
  });

  if (!project) notFound();

  const rules = await db.glossaryRule.findMany({
    where: { projectId: projektId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">
          {locale === "de" ? "Glossar" : "Glossary"}
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Upload className="mr-2 h-4 w-4" />
            {locale === "de" ? "Datei importieren" : "Import file"}
          </Button>
          <Button className="bg-indigo-600 hover:bg-indigo-700" size="sm">
            <Plus className="mr-2 h-4 w-4" />
            {locale === "de" ? "Glossarregel hinzufügen" : "Add glossary rule"}
          </Button>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl py-20 text-center">
          <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <BookOpen className="h-8 w-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {locale === "de" ? "Keine Glossarregeln vorhanden" : "No glossary rules yet"}
          </h3>
          <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
            {locale === "de"
              ? "Lege fest, dass bestimmte Begriffe immer auf eine bestimmte Weise übersetzt werden – oder gar nicht."
              : "Define terms that should always be translated in a specific way, or not translated at all."}
          </p>
          <div className="flex gap-3 justify-center">
            <Button className="bg-indigo-600 hover:bg-indigo-700">
              <Plus className="mr-2 h-4 w-4" />
              {locale === "de" ? "Glossarregel hinzufügen" : "Add glossary rule"}
            </Button>
            <Button variant="outline">
              {locale === "de" ? "Oder Datei importieren" : "Or import file"}
            </Button>
          </div>
        </div>
      ) : (
        <GlossaryTable
          rules={rules}
          projectId={projektId}
          languages={project.languages}
          originalLang={project.originalLang}
        />
      )}
    </div>
  );
}
