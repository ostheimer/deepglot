import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { GlossaryTable } from "@/components/projekte/glossary-table";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function GlossarPage({ params }: PageProps) {
  const { projektId } = await params;

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
    <GlossaryTable
      rules={rules}
      projectId={projektId}
      languages={project.languages}
      originalLang={project.originalLang}
    />
  );
}
