import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const renameSchema = z.object({ name: z.string().trim().min(2).max(100) });

export async function PATCH(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const userId = (await auth())?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  const parsed = renameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
  try {
    const workspace = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${workspaceId} FOR UPDATE`;
      const membership = await tx.organizationMember.findUnique({ where: { userId_organizationId: {
        userId, organizationId: workspaceId } }, select: { role: true } });
      if (membership?.role !== "OWNER" && membership?.role !== "ADMIN") return null;
      const previous = await tx.organization.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } });
      const renamed = await tx.organization.update({ where: { id: workspaceId },
        data: { name: parsed.data.name }, select: { id: true, name: true } });
      await tx.workspaceAudit.create({ data: { workspaceId, actorUserId: userId,
        action: "RENAME", previousName: previous.name, nextName: renamed.name } });
      return renamed;
    });
    if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    return NextResponse.json({ workspace });
  } catch { return NextResponse.json({ error: "Workspace could not be renamed" }, { status: 500 }); }
}
