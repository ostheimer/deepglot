import type {
  Prisma,
  ProjectMember,
  TranslationWorkflowStatus,
} from "@prisma/client";

export type TranslationWorkflowActor = {
  canManage: boolean;
  projectMemberId: string | null;
  langCode: string | null;
};

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

function assertLanguageAccess(
  actor: TranslationWorkflowActor,
  langTo: string,
) {
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
  langTo?: string;
  status?: TranslationWorkflowStatus;
  assignedToId?: string | null;
  query?: string;
  page?: number;
  pageSize?: number;
};

const workflowInclude = {
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
  const pageSize = Math.min(100, Math.max(1, Math.trunc(filters.pageSize ?? 25)));

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

  const where: Prisma.TranslationWhereInput = {
    projectId,
    ...(langTo ? { langTo } : {}),
    ...(filters.status ? { workflowStatus: filters.status } : {}),
    ...(filters.assignedToId !== undefined
      ? { assignedToId: filters.assignedToId }
      : {}),
    ...(filters.query?.trim()
      ? {
          OR: [
            {
              originalText: {
                contains: filters.query.trim(),
                mode: "insensitive",
              },
            },
            {
              translatedText: {
                contains: filters.query.trim(),
                mode: "insensitive",
              },
            },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.translation.findMany({
      where,
      include: workflowInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.translation.count({ where }),
  ]);

  return {
    items,
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
  patch,
}: {
  projectId: string;
  translationId: string;
  actor: TranslationWorkflowActor;
  patch: TranslationWorkflowPatch;
}) {
  const { db } = await import("@/lib/db");
  return db.$transaction(async (tx) => {
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
      actor,
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

    return tx.translation.findUniqueOrThrow({
      where: { id: current.id },
      include: workflowInclude,
    });
  });
}
