import type { OrganizationRole, Prisma, ProjectRole } from "@prisma/client";
import { canManageProject } from "@/lib/project-access-policy";
import { ProfessionalOrderError } from "@/lib/professional-orders";

/** Lock the current owner before the project, as workspace transfer does. */
export async function lockProfessionalOrderManagerScope(
  tx: Prisma.TransactionClient,
  input: { projectId: string; actorId: string },
) {
  const candidate = await tx.project.findUnique({ where: { id: input.projectId }, select: { organizationId: true } });
  if (!candidate) throw new ProfessionalOrderError("NOT_FOUND", "Project not found.");

  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${candidate.organizationId} FOR UPDATE`;
  const locked = await tx.$queryRaw<Array<{ organizationId: string; originalLang: string }>>`
    SELECT "organizationId", "originalLang" FROM "Project" WHERE "id" = ${input.projectId} FOR UPDATE
  `;
  if (locked.length !== 1 || locked[0].organizationId !== candidate.organizationId) {
    throw new ProfessionalOrderError("CONFLICT", "Project ownership changed; reload and retry.");
  }

  // Lock role rows as well: existing membership code on older main may revoke
  // without first locking the organization. FOR SHARE prevents a revocation
  // from committing between this check and our order write.
  const organizationMembers = await tx.$queryRaw<Array<{ role: OrganizationRole }>>`
    SELECT "role" FROM "OrganizationMember"
    WHERE "organizationId" = ${candidate.organizationId} AND "userId" = ${input.actorId}
    FOR SHARE
  `;
  const projectMembers = await tx.$queryRaw<Array<{ role: ProjectRole }>>`
    SELECT "role" FROM "ProjectMember"
    WHERE "projectId" = ${input.projectId} AND "userId" = ${input.actorId}
    FOR SHARE
  `;
  if (!canManageProject({ organizationRole: organizationMembers[0]?.role ?? null, projectRole: projectMembers[0]?.role ?? null })) {
    throw new ProfessionalOrderError("FORBIDDEN", "Project manager access is required.");
  }
  const languages = await tx.$queryRaw<Array<{ langCode: string }>>`
    SELECT "langCode" FROM "ProjectLanguage"
    WHERE "projectId" = ${input.projectId} AND "isActive" = true
    FOR SHARE
  `;
  return { organizationId: locked[0].organizationId, organizationRole: organizationMembers[0]?.role ?? null, sourceLanguage: locked[0].originalLang, activeLanguages: new Set(languages.map((language) => language.langCode.toLowerCase())) };
}

export function assertProfessionalOrderLanguage(scope: Awaited<ReturnType<typeof lockProfessionalOrderManagerScope>>, sourceLanguage: string, targetLanguage: string) {
  if (scope.sourceLanguage.toLowerCase() !== sourceLanguage.toLowerCase() || !scope.activeLanguages.has(targetLanguage.toLowerCase())) {
    throw new ProfessionalOrderError("CONFLICT", "Project language configuration changed; request a new quote.");
  }
}

export function assertProfessionalOrderOwner(scope: Awaited<ReturnType<typeof lockProfessionalOrderManagerScope>>, orderOrganizationId: string | null) {
  if (!orderOrganizationId || scope.organizationId !== orderOrganizationId) {
    throw new ProfessionalOrderError("CONFLICT", "Order billing ownership changed; reconcile before continuing.");
  }
}
