export type ProjectArea =
  | "overview"
  | "translations"
  | "visual-editor"
  | "analytics"
  | "settings"
  | "members"
  | "api-keys";

export type ProjectAccessContext = {
  organizationRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  projectRole: "ADMIN" | "TRANSLATOR" | null;
  langCode?: string | null;
};

export async function getAuthenticatedUserId() {
  const { auth } = await import("@/lib/auth");
  const session = await auth();

  return session?.user?.id ?? null;
}

export function canAccessProject(access: ProjectAccessContext | null) {
  if (!access) return false;

  return (
    access.organizationRole === "OWNER" ||
    access.organizationRole === "ADMIN" ||
    access.projectRole === "ADMIN" ||
    access.projectRole === "TRANSLATOR"
  );
}

export function canManageProject(access: ProjectAccessContext | null) {
  if (!access) return false;

  return (
    access.organizationRole === "OWNER" ||
    access.organizationRole === "ADMIN" ||
    access.projectRole === "ADMIN"
  );
}

export function canAccessProjectLanguage(
  access: ProjectAccessContext | null,
  langCode?: string | null
) {
  if (!access) return false;

  if (canManageProject(access)) return true;
  if (access.projectRole !== "TRANSLATOR") return false;
  if (!access.langCode) return true;

  return access.langCode.toLowerCase() === langCode?.toLowerCase();
}

export function canAccessProjectArea(
  access: ProjectAccessContext | null,
  area: ProjectArea,
  langCode?: string | null
) {
  if (!access) return false;
  if (canManageProject(access)) return true;

  if (access.projectRole !== "TRANSLATOR") {
    return false;
  }

  if (area !== "translations" && area !== "visual-editor") {
    return false;
  }

  return canAccessProjectLanguage(access, langCode);
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
