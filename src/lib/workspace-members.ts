import { Prisma, type OrganizationRole } from "@prisma/client";
import { db } from "@/lib/db";
import { BILLING_PLANS, getEffectiveWorkspacePlanKey } from "@/lib/billing-plans";

export class WorkspaceMemberError extends Error {
  constructor(public code: "NOT_FOUND" | "LIMIT" | "CONFLICT", public status: number) { super(code); }
}

async function knownCandidateIds(tx: Prisma.TransactionClient, actorUserId: string, destinationId: string) {
  const managed = await tx.organizationMember.findMany({ where: { userId: actorUserId,
    organizationId: { not: destinationId }, role: { in: ["OWNER", "ADMIN"] } }, select: { organizationId: true } });
  const rows = await tx.organizationMember.findMany({ where: {
    organizationId: { in: managed.map((row) => row.organizationId) },
  }, select: { userId: true } });
  return new Set(rows.map((row) => row.userId));
}

export async function listWorkspaceMembers(actorUserId: string, workspaceId: string) {
  const actor = await db.organizationMember.findUnique({ where: { userId_organizationId: {
    userId: actorUserId, organizationId: workspaceId } }, select: { role: true } });
  if (actor?.role !== "OWNER" && actor?.role !== "ADMIN") throw new WorkspaceMemberError("NOT_FOUND", 404);
  const [members, managed] = await Promise.all([
    db.organizationMember.findMany({ where: { organizationId: workspaceId },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" } }),
    db.organizationMember.findMany({ where: { userId: actorUserId,
      organizationId: { not: workspaceId }, role: { in: ["OWNER", "ADMIN"] } }, select: { organizationId: true } }),
  ]);
  const known = managed.length ? await db.organizationMember.findMany({ where: {
    organizationId: { in: managed.map((row) => row.organizationId) } },
    select: { userId: true, user: { select: { name: true, email: true } } } }) : [];
  const existing = new Set(members.map((row) => row.userId));
  const candidates = [...new Map(known.filter((row) => !existing.has(row.userId))
    .map((row) => [row.userId, { id: row.userId, name: row.user.name, email: row.user.email }])).values()];
  return { members: members.map((row) => ({ userId: row.userId, role: row.role,
    name: row.user.name, email: row.user.email })), candidates, actorRole: actor.role };
}

export async function changeWorkspaceMember(input: {
  actorUserId: string; workspaceId: string; action: "ADD" | "ROLE" | "REMOVE";
  targetUserId: string; role?: OrganizationRole;
}) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${input.workspaceId} FOR UPDATE`;
    const actor = await tx.organizationMember.findUnique({ where: { userId_organizationId: {
      userId: input.actorUserId, organizationId: input.workspaceId } }, select: { role: true } });
    if (actor?.role !== "OWNER" && actor?.role !== "ADMIN") throw new WorkspaceMemberError("NOT_FOUND", 404);
    const target = await tx.organizationMember.findUnique({ where: { userId_organizationId: {
      userId: input.targetUserId, organizationId: input.workspaceId } }, select: { id: true, role: true } });
    if (input.action === "ADD") {
      if (target) throw new WorkspaceMemberError("CONFLICT", 409);
      if (!input.role || (actor.role === "ADMIN" && input.role !== "MEMBER") || input.role === "OWNER") {
        throw new WorkspaceMemberError("NOT_FOUND", 404);
      }
      const known = await knownCandidateIds(tx, input.actorUserId, input.workspaceId);
      if (!known.has(input.targetUserId)) throw new WorkspaceMemberError("NOT_FOUND", 404);
      const organization = await tx.organization.findUniqueOrThrow({ where: { id: input.workspaceId },
        select: { plan: true, subscription: { select: { status: true } }, _count: { select: { members: true } } } });
      const limit = BILLING_PLANS[getEffectiveWorkspacePlanKey(organization.plan, organization.subscription)].membersLimit;
      if (organization._count.members >= limit) throw new WorkspaceMemberError("LIMIT", 409);
      await tx.organizationMember.create({ data: { organizationId: input.workspaceId,
        userId: input.targetUserId, role: input.role } });
    } else {
      if (!target) throw new WorkspaceMemberError("NOT_FOUND", 404);
      if (actor.role === "ADMIN" && target.role !== "MEMBER") throw new WorkspaceMemberError("NOT_FOUND", 404);
      if (input.action === "ROLE") {
        if (actor.role !== "OWNER" || !input.role || target.role === input.role) {
          throw new WorkspaceMemberError("CONFLICT", 409);
        }
      }
      if (target.role === "OWNER") {
        const owners = await tx.organizationMember.count({ where: { organizationId: input.workspaceId, role: "OWNER" } });
        if (owners <= 1) throw new WorkspaceMemberError("CONFLICT", 409);
      }
      if (input.action === "ROLE") {
        await tx.organizationMember.update({ where: { id: target.id }, data: { role: input.role! } });
      } else {
        await tx.organizationMember.delete({ where: { id: target.id } });
      }
    }
    const audit = await tx.workspaceAudit.create({ data: { workspaceId: input.workspaceId,
      actorUserId: input.actorUserId, action: `MEMBER_${input.action}`,
      targetUserId: input.targetUserId, previousRole: target?.role ?? null,
      nextRole: input.action === "REMOVE" ? null : input.role! } });
    return { auditId: audit.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
