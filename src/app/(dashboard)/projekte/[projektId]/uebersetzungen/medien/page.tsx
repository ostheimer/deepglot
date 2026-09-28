import { notFound } from "next/navigation";
import { MediaManager } from "@/components/projekte/media-manager";
import { db } from "@/lib/db";
import { requireProjectManagement } from "@/lib/project-page-access";

export default async function MedienPage({
  params,
}: {
  params: Promise<{ projektId: string }>;
}) {
  const { projektId } = await params;
  await requireProjectManagement(projektId);
  const project = await db.project.findUnique({
    where: { id: projektId },
    select: {
      domain: true,
      originalLang: true,
      languages: {
        select: { langCode: true, isActive: true },
        orderBy: { langCode: "asc" },
      },
    },
  });
  if (!project) notFound();
  return (
    <MediaManager
      key={projektId}
      projectId={projektId}
      domain={project.domain}
      languages={project.languages.filter(
        (language) =>
          language.langCode.toLowerCase() !==
          project.originalLang.toLowerCase(),
      )}
    />
  );
}
