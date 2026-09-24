import { Prisma, type TranslationWorkflowStatus } from "@prisma/client";
import { lockAndValidateProjectLanguageWrite } from "./project-runtime-configuration-lock";
import { canAccessProject, canManageProject } from "./project-access-policy";
import {
  planTranslationWorkflowUpdate,
  TranslationWorkflowError,
  type TranslationWorkflowActor,
  type TranslationWorkflowPatch,
} from "./translation-workflow";

export const MAX_BULK_WORKFLOW_ITEMS = 100;

export type BulkWorkflowItem = {
  id: string;
  expectedStatus: TranslationWorkflowStatus;
  expectedAssignedToId: string | null;
  expectedUpdatedAt: Date;
};

export type BulkWorkflowAction =
  | { kind: "assign"; assignedToId: string }
  | { kind: "unassign" | "submit" | "approve" | "return" | "reopen" };

export function bulkWorkflowPatch(action: BulkWorkflowAction): TranslationWorkflowPatch {
  switch (action.kind) {
    case "assign": return { assignedToId: action.assignedToId };
    case "unassign": return { assignedToId: null };
    case "submit": return { status: "IN_REVIEW" };
    case "approve": return { status: "APPROVED" };
    case "return":
    case "reopen": return { status: "ASSIGNED" };
  }
}

export function assertBulkWorkflowAction(
  action: BulkWorkflowAction,
  status: TranslationWorkflowStatus,
) {
  const required: Partial<Record<BulkWorkflowAction["kind"], TranslationWorkflowStatus>> = {
    submit: "ASSIGNED",
    approve: "IN_REVIEW",
    return: "IN_REVIEW",
    reopen: "APPROVED",
  };
  if (required[action.kind] && required[action.kind] !== status) {
    throw new TranslationWorkflowError(
      "INVALID_TRANSITION",
      "A selected segment is not in the required review state. Reload and retry.",
    );
  }
}

/** All selected rows commit together; any missing, stale or forbidden row rolls back the batch. */
export async function updateProjectTranslationsBulkWorkflow({
  projectId,
  actor,
  userId,
  items,
  action,
}: {
  projectId: string;
  actor: TranslationWorkflowActor;
  /** Revalidate authenticated access while the selected rows are locked. */
  userId?: string;
  items: BulkWorkflowItem[];
  action: BulkWorkflowAction;
}) {
  if (
    items.length < 1 || items.length > MAX_BULK_WORKFLOW_ITEMS ||
    new Set(items.map((item) => item.id)).size !== items.length ||
    items.some((item) => Number.isNaN(item.expectedUpdatedAt.getTime()))
  ) {
    throw new TranslationWorkflowError("INVALID_PAYLOAD", "Select 1 to 100 distinct segments.");
  }
  const { db } = await import("./db");
  return db.$transaction(async (tx) => {
    const ids = items.map((item) => item.id).sort();
    // Lock the project before rows, matching language-sensitive content writes.
    if (!(await lockAndValidateProjectLanguageWrite(tx, { projectId }))) {
      throw new TranslationWorkflowError("NOT_FOUND", "Project not found.");
    }
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Translation"
      WHERE "projectId" = ${projectId} AND "id" IN (${Prisma.join(ids)})
      ORDER BY "id" FOR UPDATE
    `);
    if (locked.length !== ids.length) {
      throw new TranslationWorkflowError("NOT_FOUND", "A selected segment is unavailable. Reload and retry.");
    }
    let effectiveActor = actor;
    if (userId) {
      const project = await tx.project.findUniqueOrThrow({
        where: { id: projectId }, select: { organizationId: true },
      });
      await tx.$queryRaw`
        SELECT "id" FROM "ProjectMember"
        WHERE "projectId" = ${projectId} AND "userId" = ${userId} FOR SHARE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "OrganizationMember"
        WHERE "organizationId" = ${project.organizationId} AND "userId" = ${userId} FOR SHARE
      `;
      const projectMember = await tx.projectMember.findFirst({
        where: { projectId, userId },
        select: { id: true, role: true, langCode: true },
      });
      const organizationMember = await tx.organizationMember.findFirst({
        where: { organizationId: project.organizationId, userId },
        select: { role: true },
      });
      const access = {
        projectRole: projectMember?.role ?? null,
        organizationRole: organizationMember?.role ?? null,
        langCode: projectMember?.langCode ?? null,
      };
      if (!canAccessProject(access)) {
        throw new TranslationWorkflowError("FORBIDDEN", "Project access changed. Reload and retry.");
      }
      effectiveActor = {
        canManage: canManageProject(access),
        projectMemberId: projectMember?.id ?? null,
        langCode: access.langCode,
      };
    }
    const rows = await tx.translation.findMany({
      where: { projectId, id: { in: ids } },
      select: {
        id: true, langFrom: true, langTo: true, workflowStatus: true,
        assignedToId: true, updatedAt: true,
      },
    });
    if (!(await lockAndValidateProjectLanguageWrite(tx, {
      projectId,
      sourceLanguages: rows.map((row) => row.langFrom),
      targetLanguages: rows.map((row) => row.langTo),
    }))) {
      throw new TranslationWorkflowError("INVALID_LANGUAGE", "A selected segment uses an inactive language pair.");
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (action.kind === "assign") {
      await tx.$queryRaw`SELECT "id" FROM "ProjectMember" WHERE "id" = ${action.assignedToId} FOR SHARE`;
    }
    const assignee = action.kind === "assign"
      ? await tx.projectMember.findUnique({
          where: { id: action.assignedToId },
          select: { id: true, projectId: true, langCode: true },
        })
      : null;
    for (const expected of items) {
      const current = byId.get(expected.id);
      if (!current ||
        current.workflowStatus !== expected.expectedStatus ||
        current.assignedToId !== expected.expectedAssignedToId ||
        current.updatedAt.getTime() !== expected.expectedUpdatedAt.getTime()) {
        throw new TranslationWorkflowError("STALE_UPDATE", "A selected segment changed. Reload and retry.");
      }
      assertBulkWorkflowAction(action, current.workflowStatus);
      const planned = planTranslationWorkflowUpdate({
        projectId,
        current: {
          status: current.workflowStatus,
          assignedToId: current.assignedToId,
          langTo: current.langTo,
        },
        patch: bulkWorkflowPatch(action),
        actor: effectiveActor,
        assignee,
      });
      await tx.translation.update({
        where: { id: current.id },
        data: { workflowStatus: planned.status, assignedToId: planned.assignedToId },
      });
    }
    return { updated: items.length };
  }, { timeout: 15_000 });
}
