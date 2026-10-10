import type {
  Prisma,
  ProjectMember,
  TranslationSource,
  TranslationWorkflowStatus,
} from "@prisma/client";

import { inspectPostgresText } from "@/lib/postgres-text";
import { Prisma as PrismaSql } from "@prisma/client";
import {
  observationCutoff,
  type ObservedActivity,
  type VariableQuality,
} from "./translation-quality";
import {
  workspaceSqlWhere,
  workspaceSqlOrder,
} from "./translation-workspace-query";
import { lockAndValidateProjectLanguageWrite } from "@/lib/project-runtime-configuration-lock";
import { recordTranslationCacheInvalidations } from "@/lib/translation-cache-invalidation";
import { canAccessProjectForWrite, canAccessProject, canManageProject } from "@/lib/project-access";
import { sourcePresenceSql } from "./source-page-snapshot-query";
import type { SourcePresence } from "./source-page-snapshot";

export type TranslationWorkflowActor = {
  canManage: boolean;
  projectMemberId: string | null;
  langCode: string | null;
};

export async function actorForCurrentWorkspace(tx: Prisma.TransactionClient, projectId: string,
  actorUserId: string | undefined, fallback: TranslationWorkflowActor): Promise<TranslationWorkflowActor> {
  if (!actorUserId) return fallback;
  const access = await canAccessProjectForWrite(tx, actorUserId, projectId);
  if (!canAccessProject(access)) throw new TranslationWorkflowError("NOT_FOUND", "Project not found.");
  const member = await tx.projectMember.findFirst({ where: { projectId, userId: actorUserId }, select: { id: true } });
  return { canManage: canManageProject(access), projectMemberId: member?.id ?? null,
    langCode: access?.langCode ?? null };
}

export type TranslationWorkflowPatch = {
  status?: TranslationWorkflowStatus;
  assignedToId?: string | null;
};

export type TranslationWorkflowErrorCode =
  | "FORBIDDEN"
  | "INVALID_ASSIGNEE"
  | "INVALID_LANGUAGE"
  | "INVALID_PAYLOAD"
  | "INVALID_TRANSITION"
  | "NOT_FOUND"
  | "STALE_UPDATE";

export class TranslationWorkflowError extends Error {
  constructor(
    public readonly code: TranslationWorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TranslationWorkflowError";
  }
}

export const MAX_TRANSLATION_CONTENT_LENGTH = 100_000;

export function assertValidTranslationContent(translatedText: string) {
  const postgresTextError = inspectPostgresText(translatedText, {
    boundary: "translation_workspace_edit",
    field: "translatedText",
  });
  if (
    translatedText.trim().length === 0 ||
    translatedText.length > MAX_TRANSLATION_CONTENT_LENGTH ||
    postgresTextError
  ) {
    throw new TranslationWorkflowError(
      "INVALID_PAYLOAD",
      "Translation text must be non-empty, supported text within the size limit.",
    );
  }
}

type WorkflowState = {
  status: TranslationWorkflowStatus;
  assignedToId: string | null;
  langTo: string;
};

type Assignee = Pick<ProjectMember, "id" | "projectId" | "langCode">;

const MANAGER_TRANSITIONS: Record<
  TranslationWorkflowStatus,
  ReadonlySet<TranslationWorkflowStatus>
> = {
  MACHINE: new Set(["MACHINE", "ASSIGNED"]),
  ASSIGNED: new Set(["ASSIGNED", "IN_REVIEW", "MACHINE"]),
  IN_REVIEW: new Set(["IN_REVIEW", "APPROVED", "ASSIGNED", "MACHINE"]),
  APPROVED: new Set(["APPROVED", "ASSIGNED", "MACHINE"]),
};

export function resolveTranslationWorkflowLanguage(
  actor: TranslationWorkflowActor,
  requestedLang?: string,
) {
  const normalizedRequested = requestedLang?.trim().toLowerCase() || undefined;
  const actorLanguage = actor.langCode?.trim().toLowerCase() || null;

  if (actor.canManage || !actorLanguage) return normalizedRequested;
  if (!normalizedRequested || normalizedRequested === actorLanguage) {
    return actorLanguage;
  }

  throw new TranslationWorkflowError(
    "FORBIDDEN",
    "You are not authorized for this target language.",
  );
}

export function assertTranslationContentMutationAllowed({
  actor,
  langTo,
  assignedToId,
  operation,
}: {
  actor: TranslationWorkflowActor;
  langTo: string;
  assignedToId: string | null;
  operation: "edit" | "delete";
}) {
  assertLanguageAccess(actor, langTo);

  if (actor.canManage) return;
  if (
    operation === "edit" &&
    actor.projectMemberId !== null &&
    actor.projectMemberId === assignedToId
  ) {
    return;
  }

  throw new TranslationWorkflowError(
    "FORBIDDEN",
    operation === "delete"
      ? "Only project managers may delete translation segments."
      : "Translators may only edit their own assigned segments.",
  );
}

/**
 * Editing translation content invalidates any prior review decision. Keep a
 * valid assignment so the responsible reviewer can submit the new text again;
 * otherwise return the segment to its safe machine baseline.
 */
export function resetTranslationWorkflowAfterContentEdit(current: {
  workflowStatus: TranslationWorkflowStatus;
  assignedToId: string | null;
}):
  | { workflowStatus: "ASSIGNED" }
  | { workflowStatus: "MACHINE"; assignedToId: null } {
  return current.assignedToId
    ? { workflowStatus: "ASSIGNED" }
    : { workflowStatus: "MACHINE", assignedToId: null };
}

export function workflowResetFieldsIfTranslatedTextChanged(
  existing: {
    workflowStatus: TranslationWorkflowStatus;
    assignedToId: string | null;
    translatedText: string;
  },
  nextTranslatedText: string,
):
  | ReturnType<typeof resetTranslationWorkflowAfterContentEdit>
  | Record<string, never> {
  if (existing.translatedText === nextTranslatedText) {
    return {};
  }

  return resetTranslationWorkflowAfterContentEdit(existing);
}

export function resetProjectMemberWorkflowAssignments(
  tx: Pick<Prisma.TransactionClient, "translation">,
  {
    projectId,
    memberId,
    exceptLangCode,
  }: {
    projectId: string;
    memberId: string;
    exceptLangCode?: string;
  },
) {
  return tx.translation.updateMany({
    where: {
      projectId,
      assignedToId: memberId,
      ...(exceptLangCode
        ? { langTo: { not: exceptLangCode.toLowerCase() } }
        : {}),
    },
    data: { workflowStatus: "MACHINE", assignedToId: null },
  });
}

function assertLanguageAccess(actor: TranslationWorkflowActor, langTo: string) {
  resolveTranslationWorkflowLanguage(actor, langTo);
}

function assertAssignee(
  projectId: string,
  langTo: string,
  assignedToId: string,
  assignee?: Assignee | null,
) {
  if (
    !assignee ||
    assignee.id !== assignedToId ||
    assignee.projectId !== projectId ||
    (assignee.langCode !== null &&
      assignee.langCode.toLowerCase() !== langTo.toLowerCase())
  ) {
    throw new TranslationWorkflowError(
      "INVALID_ASSIGNEE",
      "The assignee must be a project member authorized for the target language.",
    );
  }
}

export function planTranslationWorkflowUpdate({
  projectId,
  current,
  patch,
  actor,
  assignee,
}: {
  projectId: string;
  current: WorkflowState;
  patch: TranslationWorkflowPatch;
  actor: TranslationWorkflowActor;
  assignee?: Assignee | null;
}): { status: TranslationWorkflowStatus; assignedToId: string | null } {
  assertLanguageAccess(actor, current.langTo);

  const hasStatus = patch.status !== undefined;
  const hasAssignment = Object.prototype.hasOwnProperty.call(
    patch,
    "assignedToId",
  );
  if (!hasStatus && !hasAssignment) {
    throw new TranslationWorkflowError(
      "INVALID_PAYLOAD",
      "A status or assignment change is required.",
    );
  }

  if (hasAssignment && !actor.canManage) {
    throw new TranslationWorkflowError(
      "FORBIDDEN",
      "Only project managers may assign translation segments.",
    );
  }

  let assignedToId = hasAssignment
    ? (patch.assignedToId ?? null)
    : current.assignedToId;
  if (assignedToId && hasAssignment) {
    assertAssignee(projectId, current.langTo, assignedToId, assignee);
  }

  let status: TranslationWorkflowStatus;
  if (patch.status) {
    status = patch.status;
  } else {
    status = assignedToId ? "ASSIGNED" : "MACHINE";
  }

  if (!actor.canManage) {
    const isAssignedTranslator =
      actor.projectMemberId !== null &&
      actor.projectMemberId === current.assignedToId;
    const isSubmitForReview =
      current.status === "ASSIGNED" && status === "IN_REVIEW";
    const isIdempotentReview =
      current.status === "IN_REVIEW" && status === "IN_REVIEW";

    if (!isAssignedTranslator || (!isSubmitForReview && !isIdempotentReview)) {
      throw new TranslationWorkflowError(
        "FORBIDDEN",
        "Translators may only submit their own assigned segment for review.",
      );
    }
  } else if (!MANAGER_TRANSITIONS[current.status].has(status)) {
    throw new TranslationWorkflowError(
      "INVALID_TRANSITION",
      `Cannot move a translation from ${current.status} to ${status}.`,
    );
  }

  const assignmentChanged = assignedToId !== current.assignedToId;
  if (assignmentChanged && status !== "ASSIGNED" && status !== "MACHINE") {
    throw new TranslationWorkflowError(
      "INVALID_TRANSITION",
      "Changing the assignee must move the segment to assigned or machine.",
    );
  }

  if (status === "MACHINE") assignedToId = null;
  if ((status === "ASSIGNED" || status === "IN_REVIEW") && !assignedToId) {
    throw new TranslationWorkflowError(
      "INVALID_TRANSITION",
      `${status} translations require an assignee.`,
    );
  }

  return { status, assignedToId };
}

export type TranslationWorkflowFilters = {
  reportedType?: import("./translation-reported-types").ReportedTypeFilter;
  quality?: VariableQuality | "all_mismatch" | "all_match" | "all_none";
  activity?: ObservedActivity;
  sourcePresence?: SourcePresence;
  label?: string;
  variables?: "saved" | "none";
  source?: TranslationSource;
  mode?: "manual" | "automatic";
  context?: "known" | "unknown";
  urlPath?: string;
  sort?: "updated_desc" | "created_desc" | "created_asc" | "original_asc";
  langTo?: string;
  status?: TranslationWorkflowStatus;
  assignedToId?: string | null;
  query?: string;
  page?: number;
  pageSize?: number;
};

const workflowInclude = {
  typeObservations: { orderBy: { wordType: "asc" }, take: 11 },
  metadata: true,
  contexts: { orderBy: { urlPath: "asc" }, take: 100 },
  _count: { select: { contexts: true } },
  assignedTo: {
    select: {
      id: true,
      email: true,
      role: true,
      langCode: true,
      user: { select: { name: true, email: true, image: true } },
    },
  },
} satisfies Prisma.TranslationInclude;

export async function listProjectTranslationWorkflow({
  projectId,
  actor,
  filters = {},
}: {
  projectId: string;
  actor: TranslationWorkflowActor;
  filters?: TranslationWorkflowFilters;
}) {
  const { db } = await import("@/lib/db");
  const langTo = resolveTranslationWorkflowLanguage(actor, filters.langTo);
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const pageSize = Math.min(
    100,
    Math.max(1, Math.trunc(filters.pageSize ?? 25)),
  );

  if (langTo) {
    const activeLanguage = await db.projectLanguage.findFirst({
      where: { projectId, langCode: langTo, isActive: true },
      select: { id: true },
    });
    if (!activeLanguage) {
      throw new TranslationWorkflowError(
        "INVALID_LANGUAGE",
        "The target language is not active for this project.",
      );
    }
  }

  const observedAt = new Date();
  const cutoff = observationCutoff(observedAt);
  const where = workspaceSqlWhere(projectId, langTo, filters, cutoff, observedAt);
  // Count, page IDs and hydration see one snapshot even if a reviewer edits
  // content/metadata during the request. Only the bounded page leaves the DB.
  const { items, total } = await db.$transaction(
    async (tx) => {
      const totals = await tx.$queryRaw<Array<{ total: bigint }>>(PrismaSql.sql`
      SELECT count(*) AS total FROM "Translation" t WHERE ${where}
    `);
      const ids = await tx.$queryRaw<Array<{ id: string }>>(PrismaSql.sql`
      SELECT t.id FROM "Translation" t WHERE ${where}
      ORDER BY ${workspaceSqlOrder(filters.sort)}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `);
      const rows = ids.length
        ? await tx.translation.findMany({
            where: {
              projectId,
              ...(langTo ? { langTo } : {}),
              id: { in: ids.map(({ id }) => id) },
            },
            include: workflowInclude,
          })
        : [];
      const presence = ids.length ? await tx.$queryRaw<Array<{ id: string; sourcePresence: SourcePresence }>>(PrismaSql.sql`
        SELECT t.id, ${sourcePresenceSql(observedAt)} AS "sourcePresence"
        FROM "Translation" t WHERE t."projectId" = ${projectId}
          AND t.id IN (${PrismaSql.join(ids.map(({ id }) => id))})
      `) : [];
      const byId = new Map(rows.map((row) => [row.id, row]));
      const presenceById = new Map(presence.map((entry) => [entry.id, entry.sourcePresence]));
      return {
        items: ids.map(({ id }) => ({ ...byId.get(id)!, sourcePresence: presenceById.get(id) ?? "unknown" })),
        total: Number(totals[0].total),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 15_000 },
  );

  return {
    items,
    observation: { evaluatedAt: observedAt, cutoff },
    contextPaths: await db.translationContext.groupBy({
      where: { translation: { projectId, ...(langTo ? { langTo } : {}) } },
      by: ["urlPath"],
      orderBy: { urlPath: "asc" },
      take: 500,
    }),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function updateProjectTranslationWorkflow({
  projectId,
  translationId,
  actor,
  actorUserId,
  patch,
}: {
  projectId: string;
  translationId: string;
  actor: TranslationWorkflowActor;
  actorUserId?: string;
  patch: TranslationWorkflowPatch;
}) {
  const { db } = await import("@/lib/db");
  return db.$transaction(async (tx) => {
    const writeActor = await actorForCurrentWorkspace(tx, projectId, actorUserId, actor);
    const current = await tx.translation.findFirst({
      where: { id: translationId, projectId },
      select: {
        id: true,
        langTo: true,
        workflowStatus: true,
        assignedToId: true,
      },
    });
    if (!current) {
      throw new TranslationWorkflowError(
        "NOT_FOUND",
        "Translation segment not found.",
      );
    }

    const assignee = patch.assignedToId
      ? await tx.projectMember.findUnique({
          where: { id: patch.assignedToId },
          select: { id: true, projectId: true, langCode: true },
        })
      : null;
    const planned = planTranslationWorkflowUpdate({
      projectId,
      current: {
        status: current.workflowStatus,
        assignedToId: current.assignedToId,
        langTo: current.langTo,
      },
      patch,
      actor: writeActor,
      assignee,
    });

    const changed = await tx.translation.updateMany({
      where: {
        id: current.id,
        projectId,
        workflowStatus: current.workflowStatus,
        assignedToId: current.assignedToId,
      },
      data: {
        workflowStatus: planned.status,
        assignedToId: planned.assignedToId,
      },
    });
    if (changed.count !== 1) {
      throw new TranslationWorkflowError(
        "STALE_UPDATE",
        "The segment changed while it was being updated. Reload and retry.",
      );
    }

    if (actorUserId) {
      const { appendProjectAuditEvent } = await import("@/lib/audit-events");
      await appendProjectAuditEvent(tx, { projectId, actorUserId,
        action: "translation.workflow_updated", category: "translation",
        metadata: { affectedId: translationId, status: planned.status } });
    }
    return tx.translation.findUniqueOrThrow({
      where: { id: current.id },
      include: workflowInclude,
    });
  });
}

export async function updateProjectTranslationContentInTransaction(tx: Prisma.TransactionClient, {
  projectId,
  translationId,
  actor,
  translatedText,
  expectedUpdatedAt,
  actorUserId,
}: {
  projectId: string;
  translationId: string;
  actor: TranslationWorkflowActor;
  translatedText: string;
  expectedUpdatedAt: Date;
  actorUserId?: string;
}) {
  assertValidTranslationContent(translatedText);
  const { queueProjectWebhookEvent } =
    await import("@/lib/project-webhook-delivery");
  const { recordTranslationBatch } = await import("@/lib/translation-batches");
    const writeActor = await actorForCurrentWorkspace(tx, projectId, actorUserId, actor);
    const current = await tx.translation.findFirst({
      where: { id: translationId, projectId },
      select: {
        id: true,
        originalText: true,
        translatedText: true,
        langFrom: true,
        langTo: true,
        wordCount: true,
        workflowStatus: true,
        assignedToId: true,
        updatedAt: true,
        project: { select: { organizationId: true } },
      },
    });
    if (!current) {
      throw new TranslationWorkflowError(
        "NOT_FOUND",
        "Translation segment not found.",
      );
    }
    assertTranslationContentMutationAllowed({
      actor: writeActor,
      langTo: current.langTo,
      assignedToId: current.assignedToId,
      operation: "edit",
    });

    const languageConfigurationIsCurrent =
      await lockAndValidateProjectLanguageWrite(tx, {
        projectId,
        sourceLanguages: [current.langFrom],
        targetLanguages: [current.langTo],
      });
    if (!languageConfigurationIsCurrent) {
      throw new TranslationWorkflowError(
        "INVALID_LANGUAGE",
        "The translation language pair is no longer active for this project.",
      );
    }

    const lockedCurrentVersion = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Translation"
      WHERE "id" = ${current.id}
        AND "projectId" = ${projectId}
        AND "updatedAt" = ${expectedUpdatedAt}
      FOR UPDATE
    `;
    if (lockedCurrentVersion.length !== 1) {
      throw new TranslationWorkflowError(
        "STALE_UPDATE",
        "The segment changed while it was being edited. Reload and retry.",
      );
    }

    if (current.translatedText === translatedText) {
      return tx.translation.findUniqueOrThrow({
        where: { id: current.id },
        include: workflowInclude,
      });
    }

    const changed = await tx.translation.updateMany({
      where: {
        id: current.id,
        projectId,
        updatedAt: expectedUpdatedAt,
      },
      data: {
        translatedText,
        isManual: true,
        source: "MANUAL",
        ...workflowResetFieldsIfTranslatedTextChanged(current, translatedText),
      },
    });
    if (changed.count !== 1) {
      throw new TranslationWorkflowError(
        "STALE_UPDATE",
        "The segment changed while it was being edited. Reload and retry.",
      );
    }

    const saved = await tx.translation.findUniqueOrThrow({
      where: { id: current.id },
      include: workflowInclude,
    });
    await tx.translationContentRevision.create({
      data: {
        translationId: current.id,
        actorUserId: actorUserId ?? null,
        beforeText: current.translatedText,
        afterText: saved.translatedText,
      },
    });
    await recordTranslationBatch(
      {
        organizationId: current.project.organizationId,
        projectId,
        langFrom: current.langFrom,
        langTo: current.langTo,
        provider: "manual",
        totalWords: current.wordCount,
        cachedWords: 0,
        manualWords: current.wordCount,
        glossaryWords: 0,
        translatedWords: 0,
      },
      tx,
    );
    await recordTranslationCacheInvalidations(tx, projectId, [current]);
    await queueProjectWebhookEvent(
      {
        projectId,
        eventType: "translation.manual_updated",
        payload: {
          type: "translation.manual_updated",
          translationId: saved.id,
          originalText: saved.originalText,
          translatedText: saved.translatedText,
          langFrom: saved.langFrom,
          langTo: saved.langTo,
          created: false,
        },
      },
      tx,
    );

    if (actorUserId) {
      const { appendProjectAuditEvent } = await import("@/lib/audit-events");
      await appendProjectAuditEvent(tx, { projectId, actorUserId,
        action: "translation.content_updated", category: "translation",
        metadata: { affectedId: translationId } });
    }

    return saved;
}

export async function updateProjectTranslationContent(input: Parameters<typeof updateProjectTranslationContentInTransaction>[1]) {
  const { db } = await import("@/lib/db");
  return db.$transaction((tx) => updateProjectTranslationContentInTransaction(tx, input));
}

/** A manager's explicit vendor-draft adoption enters review, even in a solo workspace.
 * This never approves content; the normal IN_REVIEW → APPROVED action stays separate. */
export async function stageAdoptedProfessionalDraftForReviewInTransaction(
  tx: Prisma.TransactionClient,
  input: { projectId: string; translationId: string; actorUserId: string; langTo: string; expectedUpdatedAt: Date },
) {
  const actor = await actorForCurrentWorkspace(tx, input.projectId, input.actorUserId,
    { canManage: false, projectMemberId: null, langCode: null });
  if (!actor.canManage) throw new TranslationWorkflowError("FORBIDDEN", "Project manager access is required for adoption.");
  assertLanguageAccess(actor, input.langTo);
  const changed = await tx.translation.updateMany({
    where: { id: input.translationId, projectId: input.projectId,
      langTo: input.langTo, updatedAt: input.expectedUpdatedAt },
    data: { workflowStatus: "IN_REVIEW" },
  });
  if (changed.count !== 1) throw new TranslationWorkflowError("STALE_UPDATE", "Adopted text changed before review staging.");
}

export async function deleteProjectTranslation({
  projectId,
  translationId,
  actor,
  actorUserId,
  expectedUpdatedAt,
}: {
  projectId: string;
  translationId: string;
  actor: TranslationWorkflowActor;
  actorUserId?: string;
  expectedUpdatedAt: Date;
}) {
  const { db } = await import("@/lib/db");
  const { queueProjectWebhookEvent } =
    await import("@/lib/project-webhook-delivery");
  return db.$transaction(async (tx) => {
    const writeActor = await actorForCurrentWorkspace(tx, projectId, actorUserId, actor);
    const current = await tx.translation.findFirst({
      where: { id: translationId, projectId },
      select: {
        id: true,
        originalHash: true,
        originalText: true,
        langFrom: true,
        langTo: true,
        assignedToId: true,
        updatedAt: true,
      },
    });
    if (!current) {
      throw new TranslationWorkflowError(
        "NOT_FOUND",
        "Translation segment not found.",
      );
    }
    assertTranslationContentMutationAllowed({
      actor: writeActor,
      langTo: current.langTo,
      assignedToId: current.assignedToId,
      operation: "delete",
    });

    const deleted = await tx.translation.deleteMany({
      where: {
        id: current.id,
        projectId,
        updatedAt: expectedUpdatedAt,
      },
    });
    if (deleted.count !== 1) {
      throw new TranslationWorkflowError(
        "STALE_UPDATE",
        "The segment changed while it was being deleted. Reload and retry.",
      );
    }

    await recordTranslationCacheInvalidations(tx, projectId, [current]);

    await queueProjectWebhookEvent(
      {
        projectId,
        eventType: "translation.deleted",
        payload: {
          type: "translation.deleted",
          translationId: current.id,
          originalHash: current.originalHash,
          langFrom: current.langFrom,
          langTo: current.langTo,
        },
      },
      tx,
    );
    if (actorUserId) {
      const { appendProjectAuditEvent } = await import("@/lib/audit-events");
      await appendProjectAuditEvent(tx, { projectId, actorUserId,
        action: "translation.deleted", category: "translation",
        metadata: { affectedId: translationId } });
    }
    return { id: current.id };
  });
}
