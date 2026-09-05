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
  deleteProjectTranslation,
  MAX_TRANSLATION_CONTENT_LENGTH,
  TranslationWorkflowError,
  updateProjectTranslationContent,
  updateProjectTranslationWorkflow,
} from "@/lib/translation-workflow";

const statusMap = {
  machine: "MACHINE",
  assigned: "ASSIGNED",
  in_review: "IN_REVIEW",
  approved: "APPROVED",
} as const satisfies Record<string, TranslationWorkflowStatus>;

const workflowPatchSchema = z
  .object({
    status: z.enum(["machine", "assigned", "in_review", "approved"]).optional(),
    assignedToId: z.string().trim().min(1).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined ||
      Object.prototype.hasOwnProperty.call(value, "assignedToId"),
    { message: "A status or assignment change is required." },
  );

const contentPatchSchema = z
  .object({
    translatedText: z
      .string()
      .max(MAX_TRANSLATION_CONTENT_LENGTH)
      .refine(
        (value) => value.trim().length > 0,
        "Translation text is required.",
      ),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

const patchSchema = z.union([contentPatchSchema, workflowPatchSchema]);
const deleteSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

function errorResponse(error: unknown) {
  if (!(error instanceof TranslationWorkflowError)) {
    console.error("[translation-workflow] update failed:", error);
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

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ projektId: string; translationId: string }> },
) {
  const userId = await getAuthenticatedUserId();
  const { projektId, translationId } = await params;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const access = await getProjectAccess(userId, projektId);
  if (!access || !canAccessProject(access)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid workflow update" },
      { status: 400 },
    );
  }

  const membership = await db.projectMember.findFirst({
    where: { projectId: projektId, userId },
    select: { id: true },
  });

  try {
    const actor = {
      canManage: canManageProject(access),
      projectMemberId: membership?.id ?? null,
      langCode: access.langCode ?? null,
    };
    const translation =
      "translatedText" in parsed.data
        ? await updateProjectTranslationContent({
            projectId: projektId,
            translationId,
            actor,
            translatedText: parsed.data.translatedText,
            expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt),
          })
        : await updateProjectTranslationWorkflow({
            projectId: projektId,
            translationId,
            actor,
            patch: {
              status: parsed.data.status
                ? statusMap[parsed.data.status]
                : undefined,
              ...(Object.prototype.hasOwnProperty.call(
                parsed.data,
                "assignedToId",
              )
                ? { assignedToId: parsed.data.assignedToId }
                : {}),
            },
          });

    const { workflowStatus, ...item } = translation;
    return NextResponse.json({
      translation: { ...item, status: workflowStatus.toLowerCase() },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ projektId: string; translationId: string }> },
) {
  const userId = await getAuthenticatedUserId();
  const { projektId, translationId } = await params;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const access = await getProjectAccess(userId, projektId);
  if (!access || !canAccessProject(access)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid delete request" },
      { status: 400 },
    );
  }
  const membership = await db.projectMember.findFirst({
    where: { projectId: projektId, userId },
    select: { id: true },
  });

  try {
    await deleteProjectTranslation({
      projectId: projektId,
      translationId,
      actor: {
        canManage: canManageProject(access),
        projectMemberId: membership?.id ?? null,
        langCode: access.langCode ?? null,
      },
      expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt),
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
