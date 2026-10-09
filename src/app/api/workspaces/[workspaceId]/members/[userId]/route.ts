import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { changeWorkspaceMember, WorkspaceMemberError } from "@/lib/workspace-members";

type Context = { params: Promise<{ workspaceId: string; userId: string }> };
const schema = z.object({ role: z.enum(["OWNER", "ADMIN", "MEMBER"]) });

async function change(request: Request, context: Context, action: "ROLE" | "REMOVE") {
  const actorUserId = (await auth())?.user?.id;
  if (!actorUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId, userId } = await context.params;
  const parsed = action === "ROLE" ? schema.safeParse(await request.json().catch(() => null)) : null;
  if (action === "ROLE" && !parsed?.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try { return NextResponse.json(await changeWorkspaceMember({ actorUserId, workspaceId,
    action, targetUserId: userId, role: parsed?.success ? parsed.data.role : undefined })); }
  catch (error) { return NextResponse.json({ error: "Workspace membership could not be changed" },
    { status: error instanceof WorkspaceMemberError ? error.status : 500 }); }
}
export async function PATCH(request: Request, context: Context) { return change(request, context, "ROLE"); }
export async function DELETE(request: Request, context: Context) { return change(request, context, "REMOVE"); }
