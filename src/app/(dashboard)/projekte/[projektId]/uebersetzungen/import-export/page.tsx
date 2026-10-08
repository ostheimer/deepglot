import { notFound } from "next/navigation";

import { ImportExportPanel } from "@/components/projekte/import-export-panel";
import { db } from "@/lib/db";
import { canManageProject } from "@/lib/project-access";
import { requireProjectAccess } from "@/lib/project-page-access";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function ImportExportPage({ params }: PageProps) {
  const { projektId } = await params;
  const access = await requireProjectAccess(projektId);
  const project = await db.project.findUnique({
    where: { id: projektId },
    include: {
      languages: {
        where: { isActive: true },
        orderBy: { langCode: "asc" },
      },
    },
  });

  if (!project) {
    notFound();
  }

  return (
    <ImportExportPanel
      projectId={project.id}
      originalLang={project.originalLang}
      languages={project.languages}
      canManageExclusions={canManageProject(access)}
    />
  );
}
