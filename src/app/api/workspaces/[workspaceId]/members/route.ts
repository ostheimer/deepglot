import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listWorkspaceMembers, changeWorkspaceMember, WorkspaceMemberError } from "@/lib/workspace-members";

type Context = { params: Promise<{ workspaceId: string }> };
const schema = z.object({ userId: z.string().min(1), role: z.enum(["MEMBER", "ADMIN"]) });

export async function GET(_request: Request, context: Context) {
  const actorUserId = (await auth())?.user?.id;
  if (!actorUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await listWorkspaceMembers(actorUserId, (await context.params).workspaceId)); }
  catch (error) { return NextResponse.json({ error: "Workspace not found" },
    { status: error instanceof WorkspaceMemberError ? error.status : 500 }); }
}

export async function POST(request: Request, context: Context) {
  const actorUserId = (await auth())?.user?.id;
  if (!actorUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try { return NextResponse.json(await changeWorkspaceMember({ actorUserId, workspaceId: (await context.params).workspaceId,
    action: "ADD", targetUserId: parsed.data.userId, role: parsed.data.role }), { status: 201 }); }
  catch (error) { return NextResponse.json({ error: "Workspace membership could not be changed" },
    { status: error instanceof WorkspaceMemberError ? error.status : 500 }); }
}
