import { notFound } from "next/navigation";

import { PdfTranslationPanel } from "@/components/projekte/pdf-translation-panel";
import { db } from "@/lib/db";
import {
  canAccessProject,
  canAccessProjectLanguage,
  getAuthenticatedUserId,
  getProjectAccess,
} from "@/lib/project-access";

type PdfTranslationPageProps = {
  params: Promise<{ projektId: string }>;
};

export default async function PdfTranslationPage({
  params,
}: PdfTranslationPageProps) {
  const { projektId } = await params;
  const userId = await getAuthenticatedUserId();
  if (!userId) notFound();

  const [project, access] = await Promise.all([
    db.project.findUnique({
      where: { id: projektId },
      include: {
        languages: {
          where: { isActive: true },
          orderBy: { langCode: "asc" },
        },
      },
    }),
    getProjectAccess(userId, projektId),
  ]);

  if (!project || !access || !canAccessProject(access)) notFound();

  const languages = project.languages.filter((language) =>
    canAccessProjectLanguage(access, language.langCode)
  );

  return (
    <PdfTranslationPanel
      projectId={project.id}
      originalLang={project.originalLang}
      languages={languages.map(({ id, langCode }) => ({ id, langCode }))}
    />
  );
}
