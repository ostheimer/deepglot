import type { TranslationWorkflowStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  canAccessProject,
  canManageProject,
  getAuthenticatedUserId,
  getProjectAccess,
} from "@/lib/project-access";
import {
  listProjectTranslationWorkflow,
  TranslationWorkflowError,
} from "@/lib/translation-workflow";

const statusMap = {
  machine: "MACHINE",
  assigned: "ASSIGNED",
  in_review: "IN_REVIEW",
  approved: "APPROVED",
} as const satisfies Record<string, TranslationWorkflowStatus>;

const querySchema = z.object({
  langTo: z.string().trim().min(2).max(16).optional(),
  status: z.enum(["machine", "assigned", "in_review", "approved"]).optional(),
  assignee: z.string().trim().min(1).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

function errorResponse(error: unknown) {
  if (!(error instanceof TranslationWorkflowError)) {
    console.error("[translation-workflow] list failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const status =
    error.code === "FORBIDDEN"
      ? 403
      : error.code === "NOT_FOUND"
        ? 404
        : error.code === "INVALID_TRANSITION" || error.code === "STALE_UPDATE"
          ? 409
          : 400;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> },
) {
  const userId = await getAuthenticatedUserId();
  const { projektId } = await params;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const access = await getProjectAccess(userId, projektId);
  if (!access || !canAccessProject(access)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid translation workflow filters" },
      { status: 400 },
    );
  }

  const membership = await db.projectMember.findFirst({
    where: { projectId: projektId, userId },
    select: { id: true },
  });

  try {
    const result = await listProjectTranslationWorkflow({
      projectId: projektId,
      actor: {
        canManage: canManageProject(access),
        projectMemberId: membership?.id ?? null,
        langCode: access.langCode ?? null,
      },
      filters: {
        langTo: parsed.data.langTo,
        status: parsed.data.status ? statusMap[parsed.data.status] : undefined,
        assignedToId:
          parsed.data.assignee === "unassigned"
            ? null
            : parsed.data.assignee === "me"
              ? (membership?.id ?? "__no_membership__")
              : parsed.data.assignee,
        query: parsed.data.q,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      },
    });

    return NextResponse.json({
      ...result,
      items: result.items.map(({ workflowStatus, ...item }) => ({
        ...item,
        status: workflowStatus.toLowerCase(),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
