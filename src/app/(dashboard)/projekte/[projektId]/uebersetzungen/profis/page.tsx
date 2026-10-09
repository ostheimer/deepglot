import { notFound } from "next/navigation";

import { TranslationWorkflowPanel } from "@/components/projekte/translation-workflow-panel";
import { ProfessionalOrderPanel } from "@/components/projekte/professional-order-panel";
import { db } from "@/lib/db";
import {
  canAccessProject,
  canManageProject,
  getAuthenticatedUserId,
  getProjectAccess,
} from "@/lib/project-access";
import { getRequestLocale } from "@/lib/request-locale";
import { professionalOrdersEnabled } from "@/lib/professional-orders";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function ProfiUebersetzungenPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();
  const userId = await getAuthenticatedUserId();
  if (!userId) notFound();

  const [project, access, currentMember] = await Promise.all([
    db.project.findUnique({
      where: { id: projektId },
      select: {
        id: true,
        domain: true,
        originalLang: true,
        languages: {
          where: { isActive: true },
          select: { id: true, langCode: true },
          orderBy: { langCode: "asc" },
        },
        members: {
          select: {
            id: true,
            email: true,
            role: true,
            langCode: true,
            user: {
              select: { name: true, email: true, image: true },
            },
          },
          orderBy: { email: "asc" },
        },
      },
    }),
    getProjectAccess(userId, projektId),
    db.projectMember.findFirst({
      where: { projectId: projektId, userId },
      select: { id: true },
    }),
  ]);

  if (!project || !access || !canAccessProject(access)) notFound();
  const manageable = canManageProject(access);

  return (
    <div className="space-y-6">
    <TranslationWorkflowPanel
      domain={project.domain}
      projectId={project.id}
      languages={project.languages.filter(
        (language) =>
          manageable ||
          !access.langCode ||
          access.langCode.toLowerCase() === language.langCode.toLowerCase(),
      )}
      members={manageable ? project.members : []}
      canManage={manageable}
      currentMemberId={currentMember?.id ?? null}
      locale={locale}
      orderingEnabled={manageable && professionalOrdersEnabled()}
    />
    {manageable && professionalOrdersEnabled() && <ProfessionalOrderPanel projectId={project.id} languages={project.languages.map((language) => language.langCode)} locale={locale} />}
    </div>
  );
}
