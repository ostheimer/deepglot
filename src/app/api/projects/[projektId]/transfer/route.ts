import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { previewWorkspaceTransfer, commitWorkspaceTransfer, WorkspaceTransferError } from "@/lib/workspace-transfer";

const destinationSchema = z.object({ destinationId: z.string().min(1) });
const commitSchema = destinationSchema.extend({ fingerprint: z.string().length(64),
  issuedAt: z.string().datetime(), confirmationToken: z.string().length(64) });

async function run(request: Request, context: { params: Promise<{ projektId: string }> }, commit: boolean) {
  const actorUserId = (await auth())?.user?.id;
  if (!actorUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = (commit ? commitSchema : destinationSchema).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { projektId } = await context.params;
  try {
    const result = commit
      ? await commitWorkspaceTransfer({ actorUserId, projectId: projektId, ...commitSchema.parse(body) })
      : await previewWorkspaceTransfer(actorUserId, projektId, parsed.data.destinationId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WorkspaceTransferError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Transfer unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ projektId: string }> }) {
  return run(request, context, false);
}
export async function PUT(request: Request, context: { params: Promise<{ projektId: string }> }) {
  return run(request, context, true);
}
