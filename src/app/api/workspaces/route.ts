import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { BILLING_PLANS, getEffectiveWorkspacePlanKey } from "@/lib/billing-plans";

const createSchema = z.object({ name: z.string().trim().min(2).max(100) });

export async function GET() {
  const userId = (await auth())?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db.organizationMember.findMany({ where: { userId },
    select: { role: true, organization: { select: { id: true, name: true, plan: true,
      subscription: { select: { status: true } },
      _count: { select: { projects: true, members: true } } } } }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ workspaces: rows.map((row) => ({
    id: row.organization.id, name: row.organization.name,
    plan: getEffectiveWorkspacePlanKey(row.organization.plan, row.organization.subscription),
    _count: row.organization._count, role: row.role,
  })) });
}

export async function POST(request: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
  try {
    const workspace = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const owned = await tx.organizationMember.findMany({ where: { userId, role: "OWNER" },
        select: { organization: { select: { plan: true, subscription: { select: { status: true } } } } } });
      const limit = Math.max(1, ...owned.map((row) => BILLING_PLANS[
        getEffectiveWorkspacePlanKey(row.organization.plan, row.organization.subscription)].workspacesLimit));
      if (owned.length >= limit) return null;
      const id = crypto.randomUUID();
      const organization = await tx.organization.create({ data: {
        id, name: parsed.data.name, slug: `workspace-${id}`,
        members: { create: { userId, role: "OWNER" } },
        subscription: { create: { stripeCustomerId: `free_workspace_${id}`,
          status: "ACTIVE", plan: "FREE", wordsLimit: BILLING_PLANS.FREE.wordsLimit } },
      }, select: { id: true, name: true } });
      await tx.workspaceAudit.create({ data: { workspaceId: id, actorUserId: userId,
        action: "CREATE", nextName: parsed.data.name, targetUserId: userId, nextRole: "OWNER" } });
      return organization;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!workspace) return NextResponse.json({ error: "Workspace limit reached" }, { status: 409 });
    return NextResponse.json({ workspace }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not create workspace" }, { status: 500 });
  }
}
