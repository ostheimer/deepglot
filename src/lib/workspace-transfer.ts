import crypto from "node:crypto";
import { Prisma, type OrganizationRole } from "@prisma/client";
import { db } from "@/lib/db";
import { BILLING_PLANS, getEffectiveWordsLimit, getEffectiveWorkspacePlanKey } from "@/lib/billing-plans";
import { getUsageMonthKey } from "@/lib/translation-batches";

type Client = typeof db | Prisma.TransactionClient;

export class WorkspaceTransferError extends Error {
  constructor(public code: "NOT_FOUND" | "FORBIDDEN" | "LIMIT" | "STALE" | "PENDING" | "UNATTRIBUTED", public status: number) {
    super(code);
  }
}

function manager(role: OrganizationRole | undefined) {
  return role === "OWNER" || role === "ADMIN";
}

function fingerprint(value: unknown) {
  const key = process.env.AUTH_SECRET || process.env.DEEPGLOT_SECRET_ENCRYPTION_KEY;
  if (!key) throw new Error("Transfer signing key is not configured");
  return crypto.createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
}

async function transferState(client: Client, actorUserId: string, projectId: string, destinationId: string) {
  const project = await client.project.findUnique({
    where: { id: projectId },
    include: {
      languages: { select: { langCode: true, isActive: true } },
      members: { select: { id: true, userId: true, email: true, role: true, langCode: true } },
      invitations: { select: { id: true, acceptedAt: true } },
      apiKeys: { select: { id: true, isActive: true, createdAt: true } },
      webhookEndpoints: { select: { id: true, enabled: true, updatedAt: true } },
      settings: { select: { translationApiKeyEncrypted: true, providerReconnectRequired: true, updatedAt: true } },
    },
  });
  if (!project || project.organizationId === destinationId) {
    throw new WorkspaceTransferError("NOT_FOUND", 404);
  }
  const source = await client.organization.findUnique({ where: { id: project.organizationId }, select: {
      id: true, name: true, members: { where: { userId: actorUserId }, select: { role: true } },
    } });
  const destination = await client.organization.findUnique({ where: { id: destinationId }, select: {
      id: true, name: true, plan: true, subscription: { select: { status: true, wordsLimit: true } },
      members: { select: { userId: true, role: true } },
      _count: { select: { projects: true } },
    } });
  if (!source || !destination || !manager(source.members[0]?.role) ||
    !manager(destination.members.find((member) => member.userId === actorUserId)?.role)) {
    throw new WorkspaceTransferError("NOT_FOUND", 404);
  }
  // A manager URL operation has already claimed external provider work. Keep
  // its originating workspace, credentials and receipt/usage boundary intact
  // until the outcome is reconciled. Commit repeats this under Org -> Project
  // locks, which also serialize the provider_pending claim.
  if (await client.translatedUrl.count({ where: { projectId, operationState: "provider_pending" } })) {
    throw new WorkspaceTransferError("PENDING", 409);
  }
  // AI spend is bound to its originating organization. An in-flight or
  // unknown provider outcome cannot move across the credential-purge boundary.
  // Commit repeats this after locking both organizations and the project.
  const aiSpendState = await client.$queryRaw<Array<{ pendingCount: number; settledCount: number; version: string }>>`
    SELECT COUNT(*) FILTER (WHERE "state" IN ('DISPATCHED', 'UNKNOWN'))::int AS "pendingCount",
      COUNT(*) FILTER (WHERE "state" = 'SETTLED')::int AS "settledCount",
      COALESCE(md5(string_agg(id || ':' || "state" || ':' || "dispatchedAt"::text || ':' ||
        COALESCE("settledAt"::text, '') || ':' || COALESCE("reconciledCeilingMicros"::text, ''),
        '|' ORDER BY id)), '') AS version
    FROM "AiSpendReservation" WHERE "projectId" = ${projectId}`;
  if (aiSpendState[0]?.pendingCount) throw new WorkspaceTransferError("PENDING", 409);
  const projectAiBudget = await client.aiBudget.findUnique({ where: { projectId },
    select: { id: true, organizationId: true, revision: true, updatedAt: true } });
  // A #263 writer can still persist a receipt without this newly expanded
  // column while old and new deployments overlap. Its billing owner cannot be
  // inferred from current project ownership, even if the URL is completed.
  // Commit repeats this check under the same Org -> Project locks as writers.
  const receiptState = await client.$queryRaw<Array<{ unattributedCount: number; version: string }>>`
    SELECT COUNT(*) FILTER (WHERE "originatingOrganizationId" IS NULL)::int AS "unattributedCount",
      COALESCE(md5(string_agg(id || ':' || COALESCE("originatingOrganizationId", '') || ':' || "createdAt"::text,
        '|' ORDER BY id)), '') AS version
    FROM "UrlOperationReceipt" WHERE "projectId" = ${projectId}`;
  if (receiptState[0]?.unattributedCount) {
    throw new WorkspaceTransferError("UNATTRIBUTED", 409);
  }
  const plan = BILLING_PLANS[getEffectiveWorkspacePlanKey(destination.plan, destination.subscription)];
  const destinationWordsLimit = getEffectiveWordsLimit(destination.subscription);
  const month = getUsageMonthKey();
  const destinationUsage = await client.usageRecord.aggregate({ where: { organizationId: destinationId, month }, _sum: { words: true } });
  const sourceUsage = await client.usageRecord.aggregate({ where: { organizationId: source.id, projectId, month }, _sum: { words: true } });
  const translationSummary = await client.$queryRaw<Array<{ count: number; manualCount: number; version: string }>>`
    SELECT COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE "isManual")::int AS "manualCount",
      COALESCE(md5(string_agg(id || ':' || "updatedAt"::text, '|' ORDER BY id)), '') AS version
    FROM "Translation" WHERE "projectId" = ${projectId}`;
  const translations = translationSummary[0]!;
  const urlCount = await client.translatedUrl.count({ where: { projectId } });
  const slugCount = await client.urlSlug.count({ where: { projectId } });
  const deliveryCount = await client.webhookDelivery.count({ where: { projectId } });
  const batchCount = await client.translationBatchLog.count({ where: { projectId } });
  const mutableVersion = await client.$queryRaw<Array<{ version: string }>>`
    SELECT md5(concat_ws('|',
      (SELECT COALESCE(string_agg(id || ':' || "updatedAt"::text, '|' ORDER BY id), '') FROM "UrlSlug" WHERE "projectId" = ${projectId}),
      (SELECT COALESCE(string_agg(id || ':' || "updatedAt"::text, '|' ORDER BY id), '') FROM "GlossaryRule" WHERE "projectId" = ${projectId}),
      (SELECT COALESCE(string_agg(id || ':' || "updatedAt"::text, '|' ORDER BY id), '') FROM "ProjectMediaReplacement" WHERE "projectId" = ${projectId}),
      (SELECT COALESCE(string_agg(id || ':' || "createdAt"::text, '|' ORDER BY id), '') FROM "TranslationExclusion" WHERE "projectId" = ${projectId}),
      (SELECT COALESCE(string_agg(id || ':' || "lastSeenAt"::text || ':' || "requestCount"::text || ':' ||
        COALESCE("operationState", '') || ':' || COALESCE("operationToken", '') || ':' ||
        COALESCE("lastOperationAt"::text, '') || ':' || COALESCE("lastResult", ''), '|' ORDER BY id), '')
        FROM "TranslatedUrl" WHERE "projectId" = ${projectId}),
      (SELECT COALESCE(string_agg(id || ':' || "updatedAt"::text, '|' ORDER BY id), '') FROM "WebhookDelivery" WHERE "projectId" = ${projectId})
    )) AS version`;
  const wordsUsed = destinationUsage._sum.words ?? 0;
  const activeLanguages = project.languages.filter((language) => language.isActive).length;
  if (destination._count.projects >= plan.projectsLimit ||
    activeLanguages > plan.languagesLimit || wordsUsed >= destinationWordsLimit) {
    throw new WorkspaceTransferError("LIMIT", 409);
  }
  const destinationRoles = new Map(destination.members.map((member) => [member.userId, member.role]));
  const keptMemberIds = project.members.filter((member) => {
    if (!member.userId) return false;
    const role = destinationRoles.get(member.userId);
    return role && (member.role !== "ADMIN" || manager(role));
  }).map((member) => member.id);
  const removedMemberIds = project.members.filter((member) => !keptMemberIds.includes(member.id)).map((member) => member.id);
  const details = {
    projectId, projectName: project.name, projectVersion: project.updatedAt.toISOString(),
    sourceOrganizationId: source.id, sourceName: source.name,
    destinationOrganizationId: destination.id, destinationName: destination.name,
    destinationPlan: plan.key, destinationProjectCount: destination._count.projects,
    destinationProjectsLimit: plan.projectsLimit, destinationWordsUsed: wordsUsed,
    destinationWordsLimit, sourceProjectWordsThisMonth: sourceUsage._sum.words ?? 0,
    languages: activeLanguages, translations: translations.count,
    manualTranslations: translations.manualCount, translatedUrls: urlCount, urlSlugs: slugCount,
    keptProjectMembers: keptMemberIds.length, removedProjectMembers: removedMemberIds.length,
    revokedInvitations: project.invitations.filter((invite) => !invite.acceptedAt).length,
    revokedApiKeys: project.apiKeys.filter((key) => key.isActive).length,
    disabledWebhookEndpoints: project.webhookEndpoints.filter((endpoint) => endpoint.enabled).length,
    retainedWebhookDeliveries: deliveryCount, retainedHistoricalBatches: batchCount,
    retainedAiSpendReservations: aiSpendState[0]?.settledCount ?? 0,
    clearedAiProjectBudget: Boolean(projectAiBudget),
    clearedProviderKey: Boolean(project.settings?.translationApiKeyEncrypted),
    providerReconnectRequiredAfterTransfer: Boolean(
      project.settings?.providerReconnectRequired || project.settings?.translationApiKeyEncrypted),
  };
  const version = fingerprint({
    details, members: project.members, languages: project.languages, destinationMembers: destination.members,
    invitations: project.invitations,
    apiKeys: project.apiKeys, webhookEndpoints: project.webhookEndpoints,
    settingsUpdatedAt: project.settings?.updatedAt,
    translationVersion: translations.version, mutableVersion: mutableVersion[0]?.version,
    receiptVersion: receiptState[0]?.version,
    aiSpendVersion: aiSpendState[0]?.version,
    projectAiBudget,
  });
  return { details, version, removedMemberIds, sourceId: source.id };
}

export async function previewWorkspaceTransfer(actorUserId: string, projectId: string, destinationId: string) {
  const state = await transferState(db, actorUserId, projectId, destinationId);
  const issuedAt = new Date().toISOString();
  return { ...state.details, fingerprint: state.version, issuedAt,
    confirmationToken: fingerprint({ actorUserId, projectId, destinationId, version: state.version, issuedAt }) };
}

export async function commitWorkspaceTransfer(input: {
  actorUserId: string; projectId: string; destinationId: string;
  fingerprint: string; issuedAt: string; confirmationToken: string;
}) {
  const issued = Date.parse(input.issuedAt);
  if (!Number.isFinite(issued) || issued > Date.now() + 30_000 || Date.now() - issued > 5 * 60_000 ||
    input.confirmationToken !== fingerprint({ actorUserId: input.actorUserId, projectId: input.projectId,
      destinationId: input.destinationId, version: input.fingerprint, issuedAt: input.issuedAt })) {
    throw new WorkspaceTransferError("STALE", 409);
  }
  const finishedReceipt = async () => {
    const [audit, membership] = await Promise.all([
      db.projectTransferAudit.findUnique({ where: { previewFingerprint: input.fingerprint } }),
      db.organizationMember.findUnique({ where: { userId_organizationId: {
        userId: input.actorUserId, organizationId: input.destinationId } }, select: { role: true } }),
    ]);
    if (audit?.projectId === input.projectId && audit.actorUserId === input.actorUserId &&
      audit.destinationOrganizationId === input.destinationId && manager(membership?.role)) {
      return { auditId: audit.id, projectId: input.projectId };
    }
    return null;
  };
  const alreadyCommitted = await finishedReceipt();
  if (alreadyCommitted) return alreadyCommitted;
  try {
    // Each read after the sorted organization/project locks must see writes that
    // committed while the transfer waited for those locks.
    return await db.$transaction(async (tx) => {
    // Serialize transfers and workspace capacity changes against the organization rows.
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id IN (${input.destinationId},
      (SELECT "organizationId" FROM "Project" WHERE id = ${input.projectId})) ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${input.projectId} FOR UPDATE`;
    const state = await transferState(tx, input.actorUserId, input.projectId, input.destinationId);
    if (state.version !== input.fingerprint) throw new WorkspaceTransferError("STALE", 409);
    // Source-only project roles and all outstanding source invitations must not
    // grant access in the destination. Translation assignments become unassigned.
    await tx.projectInvitation.deleteMany({ where: { projectId: input.projectId, acceptedAt: null } });
    if (state.removedMemberIds.length) {
      await tx.projectMember.deleteMany({ where: { id: { in: state.removedMemberIds } } });
    }
    await tx.apiKey.updateMany({ where: { projectId: input.projectId }, data: { isActive: false } });
    await tx.webhookDelivery.updateMany({ where: { projectId: input.projectId, status: "PENDING" },
      data: { status: "FAILED", errorMessage: "Workspace transfer requires webhook reconnect" } });
    await tx.webhookEndpoint.updateMany({ where: { projectId: input.projectId }, data: { enabled: false, secret: "" } });
    await tx.projectSettings.updateMany({ where: { projectId: input.projectId }, data: {
      translationApiKeyEncrypted: null, translationApiKeyUpdatedAt: null,
      providerReconnectRequired: state.details.providerReconnectRequiredAfterTransfer,
      runtimeSyncedAt: null, runtimeSyncSiteHost: null, runtimeSyncApiKeyId: null,
      runtimeSyncConflicts: [],
    } });
    // Approval belongs to the source workspace; the destination owner must
    // approve a new project policy. Sparse spend rows and approval events keep
    // their immutable original organization and project attribution.
    await tx.aiBudget.deleteMany({ where: { projectId: input.projectId } });
    await tx.project.update({ where: { id: input.projectId }, data: { organizationId: input.destinationId } });
    const audit = await tx.projectTransferAudit.create({ data: {
      projectId: input.projectId, actorUserId: input.actorUserId,
      sourceOrganizationId: state.sourceId, destinationOrganizationId: input.destinationId,
      previewFingerprint: state.version, projectVersion: new Date(state.details.projectVersion),
    } });
    return { auditId: audit.id, projectId: input.projectId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 });
  } catch (error) {
    const concurrentReceipt = await finishedReceipt();
    if (concurrentReceipt) return concurrentReceipt;
    throw error;
  }
}
