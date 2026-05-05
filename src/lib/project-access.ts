import {
  canAccessProject,
  canManageProject,
  type ProjectAccessContext,
} from "@/lib/project-access-policy";

export {
  canAccessProject,
  canAccessProjectArea,
  canAccessProjectLanguage,
  canManageProject,
  type ProjectAccessContext,
  type ProjectArea,
} from "@/lib/project-access-policy";

export async function getAuthenticatedUserId() {
  const { auth } = await import("@/lib/auth");
  const session = await auth();

  return session?.user?.id ?? null;
}

export async function getProjectAccess(userId: string, projectId: string) {
  const { db } = await import("@/lib/db");
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      organization: {
        select: {
          members: {
            where: { userId },
            select: { role: true },
            take: 1,
          },
        },
      },
      members: {
        where: { userId },
        select: { role: true, langCode: true },
        take: 1,
      },
    },
  });

  if (!project) return null;

  return {
    organizationRole: project.organization.members[0]?.role ?? null,
    projectRole: project.members[0]?.role ?? null,
    langCode: project.members[0]?.langCode ?? null,
  } satisfies ProjectAccessContext;
}

export async function userHasProjectAccess(userId: string, projectId: string) {
  const access = await getProjectAccess(userId, projectId);

  return canAccessProject(access);
}

export async function userCanManageProject(userId: string, projectId: string) {
  const access = await getProjectAccess(userId, projectId);

  return canManageProject(access);
}
