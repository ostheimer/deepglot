import {
  canAccessProject,
  canManageProject,
  type ProjectAccessContext,
} from "@/lib/project-access-policy";
import type { Prisma } from "@prisma/client";

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

/** Lock in the same Organization -> Project order as transfer and member changes. */
export async function lockProjectMembershipScope(tx: Prisma.TransactionClient, projectId: string) {
  const candidate = await tx.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
  if (!candidate) return null;
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${candidate.organizationId} FOR UPDATE`;
  const rows = await tx.$queryRaw<Array<{ organizationId: string }>>`
    SELECT "organizationId" FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
  // Transfer may have moved the project between the unlocked first read and
  // the lock. The caller retries under the new workspace rather than writing
  // with a membership snapshot from the former workspace.
  return rows[0]?.organizationId === candidate.organizationId ? candidate.organizationId : null;
}

/** Recheck current ownership and membership under locks shared with transfer and revocation. */
export async function canManageProjectForWrite(tx: Prisma.TransactionClient, userId: string, projectId: string) {
  const organizationId = await lockProjectMembershipScope(tx, projectId);
  if (!organizationId) return false;
  const membership = await tx.organizationMember.findUnique({ where: { userId_organizationId: {
    userId, organizationId } }, select: { role: true } });
  const projectMember = await tx.projectMember.findFirst({ where: { projectId, userId }, select: { role: true } });
  return canManageProject({ organizationRole: membership?.role ?? null,
    projectRole: projectMember?.role ?? null });
}

/** Language/editor writes permit scoped translators after the same ownership lock. */
export async function canAccessProjectForWrite(tx: Prisma.TransactionClient, userId: string, projectId: string) {
  const organizationId = await lockProjectMembershipScope(tx, projectId);
  if (!organizationId) return null;
  const membership = await tx.organizationMember.findUnique({ where: { userId_organizationId: {
    userId, organizationId } }, select: { role: true } });
  const projectMember = await tx.projectMember.findFirst({ where: { projectId, userId }, select: { role: true, langCode: true } });
  const access = { organizationRole: membership?.role ?? null, projectRole: projectMember?.role ?? null,
    langCode: projectMember?.langCode ?? null } satisfies ProjectAccessContext;
  return canAccessProject(access) ? access : null;
}
