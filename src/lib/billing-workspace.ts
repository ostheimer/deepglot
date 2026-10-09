import { db } from "@/lib/db";
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
