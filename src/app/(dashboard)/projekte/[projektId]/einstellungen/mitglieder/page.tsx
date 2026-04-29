import { notFound, redirect } from "next/navigation";

import { ProjectMembersManager } from "@/components/projekte/project-members-manager";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userCanManageProject } from "@/lib/project-access";
import { getRequestLocale } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function MitgliederPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();
  const session = await auth();

  if (!session?.user?.id) {
    redirect(withLocalePrefix("/login", locale));
  }

  if (!(await userCanManageProject(session.user.id, projektId))) {
    notFound();
  }

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: {
      languages: {
        where: { isActive: true },
        orderBy: { langCode: "asc" },
      },
      members: {
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
        orderBy: { createdAt: "asc" },
      },
      invitations: {
        where: { acceptedAt: null },
        select: {
          id: true,
          email: true,
          role: true,
          langCode: true,
          expiresAt: true,
          createdAt: true,
          inviter: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      organization: {
        include: {
          members: {
            where: { role: { in: ["OWNER", "ADMIN"] } },
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!project) notFound();

  return (
    <ProjectMembersManager
      projectId={project.id}
      languages={project.languages}
      members={project.members}
      invitations={project.invitations}
      organizationAdmins={project.organization.members}
    />
  );
}
