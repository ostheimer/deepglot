import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { LocaleSearchParams } from "@/lib/request-locale";

export async function workspaceIdFromSearchParams(params?: LocaleSearchParams) {
  if (!params) return null;
  const value = (await params).workspaceId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Resolve current membership on every request. Ambiguous accounts must select. */
export async function resolveBillingWorkspaceId(userId: string, explicitId: string | null,
  manageOnly: boolean): Promise<string | null> {
  if (explicitId) {
    const member = await db.organizationMember.findUnique({ where: { userId_organizationId: {
      userId, organizationId: explicitId } }, select: { role: true } });
    if (!member || (manageOnly && member.role !== "OWNER" && member.role !== "ADMIN")) return null;
    return explicitId;
  }
  const members = await db.organizationMember.findMany({ where: { userId },
    select: { organizationId: true, role: true }, take: 2 });
  if (members.length !== 1 || (manageOnly && members[0].role !== "OWNER" && members[0].role !== "ADMIN")) return null;
  return members[0].organizationId;
}

/**
 * Linearize external billing authorization with membership changes. The
 * committed receipt is the authority for dispatch after this short DB
 * transaction; no row lock is held during Stripe HTTP calls.
 */
export async function authorizeBillingCommand(input: {
  actorUserId: string;
  workspaceId: string;
  action: "CHECKOUT" | "CANCEL" | "ADDRESS" | "PORTAL";
  priceId?: string;
}) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${input.workspaceId} FOR UPDATE`;
    const membership = await tx.organizationMember.findUnique({
      where: { userId_organizationId: { userId: input.actorUserId, organizationId: input.workspaceId } },
      include: { organization: { include: { subscription: true } } },
    });
    if (membership?.role !== "OWNER" && membership?.role !== "ADMIN") return null;
    const subscription = membership.organization.subscription;
    const targetRef = input.action === "CHECKOUT" ? input.priceId ?? null
      : input.action === "CANCEL" ? subscription?.stripeSubscriptionId ?? null
      : subscription?.stripeCustomerId ?? null;
    const command = await tx.billingCommand.create({ data: {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      actorRole: membership.role,
      action: input.action,
      targetRef,
    } });
    return { commandId: command.id, organization: membership.organization, targetRef };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
