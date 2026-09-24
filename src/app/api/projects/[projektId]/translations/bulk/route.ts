import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  canAccessProject, canManageProject, getAuthenticatedUserId, getProjectAccess,
} from "@/lib/project-access";
import {
  MAX_BULK_WORKFLOW_ITEMS, updateProjectTranslationsBulkWorkflow,
} from "@/lib/translation-bulk-workflow";
import { TranslationWorkflowError } from "@/lib/translation-workflow";

const itemSchema = z.object({
  id: z.string().min(1),
  expectedStatus: z.enum(["MACHINE", "ASSIGNED", "IN_REVIEW", "APPROVED"]),
  expectedAssignedToId: z.string().min(1).nullable(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();

const schema = z.object({
  items: z.array(itemSchema).min(1).max(MAX_BULK_WORKFLOW_ITEMS),
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("assign"), assignedToId: z.string().min(1) }).strict(),
    ...(["unassign", "submit", "approve", "return", "reopen"] as const).map(
      (kind) => z.object({ kind: z.literal(kind) }).strict(),
    ),
  ]),
}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> },
) {
  const userId = await getAuthenticatedUserId();
  const { projektId } = await params;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const access = await getProjectAccess(userId, projektId);
  if (!access || !canAccessProject(access)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid bulk workflow request" }, { status: 400 });
  }
  const membership = await db.projectMember.findFirst({
    where: { projectId: projektId, userId }, select: { id: true },
  });
  try {
    const result = await updateProjectTranslationsBulkWorkflow({
      projectId: projektId,
      userId,
      actor: {
        canManage: canManageProject(access),
        projectMemberId: membership?.id ?? null,
        langCode: access.langCode ?? null,
      },
      items: parsed.data.items.map((item) => ({
        ...item, expectedUpdatedAt: new Date(item.expectedUpdatedAt),
      })),
      action: parsed.data.action,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (!(error instanceof TranslationWorkflowError)) {
      console.error("[translation-bulk-workflow] update failed:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    const status = error.code === "FORBIDDEN" ? 403
      : error.code === "NOT_FOUND" ? 404
      : error.code === "STALE_UPDATE" || error.code === "INVALID_TRANSITION" ? 409
      : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
}
