import { notFound } from "next/navigation";

import { ExclusionsManager } from "@/components/projekte/exclusions-manager";
import { db } from "@/lib/db";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function AusnahmenPage({ params }: PageProps) {
  const { projektId } = await params;

  const project = await db.project.findUnique({
    where: { id: projektId },
    select: {
      id: true,
      exclusions: {
        orderBy: [{ createdAt: "desc" }, { value: "asc" }],
        select: {
          id: true,
          type: true,
          value: true,
          createdAt: true,
        },
      },
    },
  });

  if (!project) {
    notFound();
  }

  return (
    <ExclusionsManager
      projectId={project.id}
      exclusions={project.exclusions.map((exclusion) => ({
        ...exclusion,
        createdAt: exclusion.createdAt.toISOString(),
      }))}
    />
  );
}
