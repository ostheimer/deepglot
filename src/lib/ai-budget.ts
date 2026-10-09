import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { canAccessProject, canAccessProjectLanguage } from "@/lib/project-access-policy";
import {
  AiBudgetError, conservativeInputUnits, quotedMicros, spendWithinCap, utcPeriodKey,
  type ApprovedPrice, type AiPriceUnit,
} from "@/lib/ai-budget-math";

type BudgetWithModels = Prisma.AiBudgetGetPayload<{ include: { models: true } }>;

export type AiSpendAttempt = {
  organizationId: string;
  projectId: string;
  requestKey: string;
  requestGroupKey: string;
  dispatchId: string;
  actorKind: "USER" | "API_KEY";
  actorId: string;
  sourceLang?: string;
  targetLang?: string;
  expectedSettingsUpdatedAt?: string | null;
  action: string;
  provider: string;
  model: string;
  input: unknown;
};

export type AiSpendApproval = {
  reservationId: string;
  currency: string;
  reservedMicros: string;
  inputUnits: number;
  maxOutputUnits: number;
  unit: AiPriceUnit;
};

export async function preflightAiSpend(input: {
  organizationId: string; projectId: string; provider: string; model: string;
  inputUnits?: number; outputUnits?: number; dispatchInput?: unknown;
}) {
  const project = await db.project.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId }, select: { id: true },
  });
  if (!project) throw new AiBudgetError("project_changed", "Project ownership changed.");
  const budgets = await db.aiBudget.findMany({
    where: { organizationId: input.organizationId, OR: [{ projectId: null }, { projectId: input.projectId }] },
    include: { models: true },
  });
  const organizationBudget = budgets.find((item) => item.projectId === null);
  const projectBudget = budgets.find((item) => item.projectId === input.projectId);
  if (!organizationBudget || !projectBudget) throw new AiBudgetError("budget_unapproved", "Both organization and project budgets require owner approval.");
  if (organizationBudget.currency !== projectBudget.currency ||
      organizationBudget.period !== "MONTHLY_UTC" || projectBudget.period !== "MONTHLY_UTC") {
    throw new AiBudgetError("budget_ambiguous", "Budget currency or period does not match.");
  }
  const orgPrice = approvedPrice(organizationBudget, input.provider, input.model);
  const projectPrice = approvedPrice(projectBudget, input.provider, input.model);
  if (orgPrice.unit !== projectPrice.unit) throw new AiBudgetError("price_ambiguous", "Approved price units do not match.");
  const inputUnits = input.dispatchInput === undefined
    ? input.inputUnits : conservativeInputUnits(input.dispatchInput, orgPrice.unit);
  const outputUnits = input.outputUnits ?? Math.min(orgPrice.maxOutputUnits, projectPrice.maxOutputUnits);
  if (inputUnits === undefined) throw new AiBudgetError("estimate_unbounded", "No dispatch input bound was provided.");
  const now = new Date();
  const orgQuote = quotedMicros(orgPrice, inputUnits, outputUnits, now);
  const projectQuote = quotedMicros(projectPrice, inputUnits, outputUnits, now);
  const estimatedMaxMicros = orgQuote > projectQuote ? orgQuote : projectQuote;
  const periodKey = utcPeriodKey(now);
  const { organizationMicros: orgCommitted, projectMicros: projectCommitted } =
    await readAiSpendTotals(db, input.organizationId, input.projectId, periodKey, organizationBudget.currency);
  const allowed = estimatedMaxMicros <= organizationBudget.perCallCapMicros &&
    estimatedMaxMicros <= projectBudget.perCallCapMicros &&
    spendWithinCap(orgCommitted, estimatedMaxMicros, organizationBudget.capMicros) &&
    spendWithinCap(projectCommitted, estimatedMaxMicros, projectBudget.capMicros);
  return {
    allowed, code: allowed ? "approved_estimate" : "budget_exhausted",
    currency: organizationBudget.currency, unit: orgPrice.unit, inputUnits, outputUnits,
    estimatedMaxMicros: estimatedMaxMicros.toString(), periodKey,
    organizationRemainingMicros: (organizationBudget.capMicros - orgCommitted).toString(),
    projectRemainingMicros: (projectBudget.capMicros - projectCommitted).toString(),
    platformCredits: false, paidFeatureActivation: false, externalProviderCost: orgPrice.unit !== "ZERO_COST",
    note: "Read-only estimate. Dispatch repeats authorization and atomically reserves the conservative ceiling.",
  };
}

function approvedPrice(budget: BudgetWithModels, provider: string, model: string): ApprovedPrice {
  const allowance = budget.models.find((item) => item.provider === provider && item.model === model);
  if (!allowance) throw new AiBudgetError("model_not_approved", "This provider and model have no approved price ceiling.");
  if ((provider === "openrouter" || provider === "openai-compatible" ||
      (provider === "ollama" && allowance.unit !== "ZERO_COST")) && !allowance.outputCapVerified) {
    throw new AiBudgetError("capability_unverified", "The selected gateway model has no verified output cap contract.");
  }
  if (allowance.unit !== "TOKEN" && allowance.unit !== "CHARACTER" && allowance.unit !== "ZERO_COST") {
    throw new AiBudgetError("price_unavailable", "Unknown provider price unit.");
  }
  return {
    unit: allowance.unit,
    inputMicrosPerMillion: allowance.inputMicrosPerMillion,
    outputMicrosPerMillion: allowance.outputMicrosPerMillion,
    maxInputUnits: allowance.maxInputUnits,
    maxOutputUnits: allowance.maxOutputUnits,
    priceExpiresAt: allowance.priceExpiresAt,
  };
}

type SpendReader = Pick<typeof db, "$queryRaw">;

/** No FX exists: every current-period reservation must use the policy currency. */
export async function readAiSpendTotals(tx: SpendReader, organizationId: string, projectId: string,
  periodKey: number, currency: string | null) {
  const rows = await tx.$queryRaw<Array<{ total: bigint; projectTotal: bigint; incompatible: bigint; rowCount: bigint }>>`
    SELECT COALESCE(SUM(CASE WHEN "state" = 'SETTLED'
      THEN COALESCE("reconciledCeilingMicros", "reservedMicros")
      ELSE "reservedMicros" END), 0)::bigint AS total,
      COALESCE(SUM(CASE WHEN "state" = 'SETTLED'
        THEN COALESCE("reconciledCeilingMicros", "reservedMicros")
        ELSE "reservedMicros" END) FILTER (WHERE "projectId" = ${projectId}), 0)::bigint AS "projectTotal",
      COUNT(*) FILTER (WHERE "currency" IS DISTINCT FROM ${currency})::bigint AS incompatible,
      COUNT(*)::bigint AS "rowCount"
    FROM "AiSpendReservation"
    WHERE "organizationId" = ${organizationId} AND "periodKey" = ${periodKey}
  `;
  const totals = rows[0];
  if (totals?.incompatible && totals.incompatible > BigInt(0)) {
    throw new AiBudgetError("budget_currency_conflict", "Current-period spend has another currency; no FX conversion is approved.");
  }
  return { organizationMicros: totals?.total ?? BigInt(0),
    projectMicros: totals?.projectTotal ?? BigInt(0), rowCount: totals?.rowCount ?? BigInt(0) };
}

export async function assertAiSpendLedgerCurrency(tx: SpendReader, organizationId: string,
  periodKey: number, currency: string) {
  await readAiSpendTotals(tx, organizationId, "", periodKey, currency);
}

/** The Organization→Project row order matches workspace transfer and role guards. */
export async function lockAiSpendScope(tx: Prisma.TransactionClient, organizationId: string, projectId: string) {
  const organization = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE
  `;
  if (organization.length !== 1) throw new AiBudgetError("budget_unavailable", "Organization is unavailable.");
  const project = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Project" WHERE "id" = ${projectId} AND "organizationId" = ${organizationId} FOR UPDATE
  `;
  if (project.length !== 1) throw new AiBudgetError("project_changed", "Project ownership changed.");
}

export async function reserveAiSpend(attempt: AiSpendAttempt): Promise<AiSpendApproval> {
  return db.$transaction((tx) => reserveAiSpendInTransaction(tx, attempt));
}

/** Reuse the caller's Organization→Project transaction for an atomic dispatch marker. */
export async function reserveAiSpendInTransaction(tx: Prisma.TransactionClient,
  attempt: AiSpendAttempt, scopeAlreadyLocked = false): Promise<AiSpendApproval> {
  if (!attempt.requestKey || !attempt.requestGroupKey || !attempt.dispatchId || !attempt.actorId || !attempt.projectId || !attempt.organizationId ||
      !attempt.action || !attempt.provider || !attempt.model) {
    throw new AiBudgetError("budget_unavailable", "Spend identity is incomplete.");
  }
  const requestKeyHash = crypto.createHash("sha256").update(attempt.requestKey).digest("hex");
  const requestGroupHash = crypto.createHash("sha256").update(attempt.requestGroupKey).digest("hex");
  if (!scopeAlreadyLocked) await lockAiSpendScope(tx, attempt.organizationId, attempt.projectId);
    const now = new Date();
    if (attempt.actorKind === "API_KEY") {
      const keys = await tx.$queryRaw<Array<{ id: string; projectId: string; isActive: boolean; expiresAt: Date | null }>>`
        SELECT "id", "projectId", "isActive", "expiresAt" FROM "ApiKey"
        WHERE "id" = ${attempt.actorId} FOR SHARE
      `;
      const key = keys[0];
      if (!key || key.projectId !== attempt.projectId || !key.isActive ||
          (key.expiresAt && key.expiresAt <= now)) {
        throw new AiBudgetError("actor_revoked", "The API key is no longer authorized for this project.");
      }
    } else {
      const [membership, projectMember] = await Promise.all([
        tx.organizationMember.findUnique({
          where: { userId_organizationId: { userId: attempt.actorId, organizationId: attempt.organizationId } },
          select: { role: true },
        }),
        tx.projectMember.findFirst({
          where: { userId: attempt.actorId, projectId: attempt.projectId },
          select: { role: true, langCode: true },
        }),
      ]);
      const access = { organizationRole: membership?.role ?? null,
        projectRole: projectMember?.role ?? null, langCode: projectMember?.langCode ?? null };
      const allowed = attempt.targetLang
        ? canAccessProjectLanguage(access, attempt.targetLang)
        : canAccessProject(access) && projectMember?.role !== "TRANSLATOR";
      if (!allowed) throw new AiBudgetError("actor_revoked", "The user no longer has access to this project and language.");
    }
    if (["TRANSLATION", "CONTEXT_TRANSLATION", "BULK_TRANSLATION", "PDF_TRANSLATION", "AI_EDIT"].includes(attempt.action)) {
      if (!attempt.sourceLang || !attempt.targetLang) {
        throw new AiBudgetError("project_changed", "Translation language scope is missing.");
      }
      const project = await tx.project.findUnique({
        where: { id: attempt.projectId },
        select: { originalLang: true, languages: { where: { isActive: true }, select: { langCode: true } },
          settings: { select: { automaticTranslation: true, providerReconnectRequired: true, updatedAt: true } } },
      });
      if (!project || project.originalLang.toLowerCase() !== attempt.sourceLang.toLowerCase() ||
          !project.languages.some((language) => language.langCode.toLowerCase() === attempt.targetLang!.toLowerCase()) ||
          (["TRANSLATION", "CONTEXT_TRANSLATION", "BULK_TRANSLATION"].includes(attempt.action) &&
            project.settings?.automaticTranslation === false) ||
          project.settings?.providerReconnectRequired === true ||
          (attempt.expectedSettingsUpdatedAt ?? null) !== (project.settings?.updatedAt.toISOString() ?? null)) {
        throw new AiBudgetError("project_changed", "Translation configuration changed before provider dispatch.");
      }
    }
    const priorGroup = await tx.aiSpendReservation.findFirst({
      where: { organizationId: attempt.organizationId, requestGroupHash, dispatchId: { not: attempt.dispatchId } },
      select: { id: true },
    });
    if (priorGroup) throw new AiBudgetError("spend_already_dispatched", "This request has already reached a provider. Check its settlement before retrying.");
    const existing = await tx.aiSpendReservation.findUnique({
      where: { organizationId_requestKeyHash: { organizationId: attempt.organizationId, requestKeyHash } },
    });
    if (existing) throw new AiBudgetError("spend_already_dispatched", "This request has already reached a provider. Check its settlement before retrying.");

    const periodKey = utcPeriodKey(now);
    const budgets = await tx.aiBudget.findMany({
      where: { organizationId: attempt.organizationId, OR: [{ projectId: null }, { projectId: attempt.projectId }] },
      include: { models: true },
    });
    const organizationBudget = budgets.find((item) => item.projectId === null);
    const projectBudget = budgets.find((item) => item.projectId === attempt.projectId);
    if (!organizationBudget || !projectBudget) throw new AiBudgetError("budget_unapproved", "An owner must approve both organization and project budgets.");
    if (organizationBudget.period !== "MONTHLY_UTC" || projectBudget.period !== "MONTHLY_UTC" ||
        organizationBudget.currency !== projectBudget.currency) {
      throw new AiBudgetError("budget_ambiguous", "Budget period or currency does not match.");
    }
    const orgPrice = approvedPrice(organizationBudget, attempt.provider, attempt.model);
    const projectPrice = approvedPrice(projectBudget, attempt.provider, attempt.model);
    if (orgPrice.unit !== projectPrice.unit) throw new AiBudgetError("price_ambiguous", "Approved price units do not match.");
    const inputUnits = conservativeInputUnits(attempt.input, orgPrice.unit);
    const maxOutputUnits = Math.min(orgPrice.maxOutputUnits, projectPrice.maxOutputUnits);
    const orgQuote = quotedMicros(orgPrice, inputUnits, maxOutputUnits, now);
    const projectQuote = quotedMicros(projectPrice, inputUnits, maxOutputUnits, now);
    const reservedMicros = orgQuote > projectQuote ? orgQuote : projectQuote;
    if (reservedMicros > organizationBudget.perCallCapMicros || reservedMicros > projectBudget.perCallCapMicros) {
      throw new AiBudgetError("per_call_cap_exceeded", "The provider attempt exceeds an approved per-call ceiling.");
    }
    const { organizationMicros: orgCommitted, projectMicros: projectCommitted } =
      await readAiSpendTotals(tx, attempt.organizationId, attempt.projectId, periodKey,
        organizationBudget.currency);
    if (!spendWithinCap(orgCommitted, reservedMicros, organizationBudget.capMicros) ||
        !spendWithinCap(projectCommitted, reservedMicros, projectBudget.capMicros)) {
      throw new AiBudgetError("budget_exhausted", "The approved AI budget has no room for this attempt.");
    }
    const reservation = await tx.aiSpendReservation.create({
      data: {
        organizationId: attempt.organizationId, projectId: attempt.projectId,
        requestKeyHash, requestGroupHash, dispatchId: attempt.dispatchId,
        actorKind: attempt.actorKind, actorId: attempt.actorId,
        action: attempt.action, provider: attempt.provider, model: attempt.model,
        currency: organizationBudget.currency, periodKey, state: "DISPATCHED",
        reservedMicros, estimatedInputUnits: inputUnits, maxOutputUnits, unit: orgPrice.unit,
        orgInputMicrosPerMillion: orgPrice.inputMicrosPerMillion,
        orgOutputMicrosPerMillion: orgPrice.outputMicrosPerMillion,
        projectInputMicrosPerMillion: projectPrice.inputMicrosPerMillion,
        projectOutputMicrosPerMillion: projectPrice.outputMicrosPerMillion,
      },
    });
    for (const [budget, prior] of [[organizationBudget, orgCommitted], [projectBudget, projectCommitted]] as const) {
      for (const threshold of [budget.warningPercent, 100]) {
        if (prior * BigInt(100) < budget.capMicros * BigInt(threshold) &&
            (prior + reservedMicros) * BigInt(100) >= budget.capMicros * BigInt(threshold)) {
          const eventId = crypto.createHash("sha256").update(`${budget.id}:${periodKey}:${threshold}`).digest("hex");
          await tx.aiBudgetEvent.createMany({
            data: [{ id: eventId, organizationId: attempt.organizationId,
              projectId: budget.projectId, budgetId: budget.id,
              kind: threshold === 100 ? "CAP_REACHED" : "WARNING_REACHED",
              periodKey, threshold }],
            skipDuplicates: true,
          });
        }
      }
    }
    return {
      reservationId: reservation.id, currency: reservation.currency,
      reservedMicros: reservation.reservedMicros.toString(), inputUnits,
      maxOutputUnits, unit: orgPrice.unit,
    };
}

/** Missing, malformed or unexpectedly high usage remains charged at the hold. */
export async function settleAiSpend(reservationId: string, usage?: { inputUnits: number; outputUnits: number }) {
  return db.$transaction(async (tx) => {
    // The first read only identifies the lock scope. It must not authorize a
    // transition because another settlement can finish while this one waits.
    const scope = await tx.aiSpendReservation.findUnique({ where: { id: reservationId },
      select: { organizationId: true, projectId: true } });
    if (!scope) throw new AiBudgetError("budget_unavailable", "Spend reservation is missing.");
    await lockAiSpendScope(tx, scope.organizationId, scope.projectId);
    const reservation = await tx.aiSpendReservation.findUnique({ where: { id: reservationId } });
    if (!reservation || reservation.organizationId !== scope.organizationId || reservation.projectId !== scope.projectId) {
      throw new AiBudgetError("budget_unavailable", "Spend reservation scope changed.");
    }
    if (reservation.state !== "DISPATCHED") return reservation;
    const finish = async (data: Prisma.AiSpendReservationUpdateManyMutationInput) => {
      const changed = await tx.aiSpendReservation.updateMany({
        where: { id: reservationId, organizationId: scope.organizationId,
          projectId: scope.projectId, state: "DISPATCHED" }, data,
      });
      if (changed.count !== 1) throw new AiBudgetError("budget_unavailable", "Spend settlement changed concurrently.");
      return tx.aiSpendReservation.findUniqueOrThrow({ where: { id: reservationId } });
    };
    const complete = usage && Number.isSafeInteger(usage.inputUnits) &&
      Number.isSafeInteger(usage.outputUnits) && usage.inputUnits >= 0 && usage.outputUnits >= 0 &&
      usage.inputUnits <= reservation.estimatedInputUnits && usage.outputUnits <= reservation.maxOutputUnits;
    if (!complete || !usage) {
      return finish({ state: "UNKNOWN", reconciledCeilingMicros: null,
        actualInputUnits: null, actualOutputUnits: null, settledAt: new Date() });
    }
    const now = new Date();
    const actual = measuredCeiling(reservation, usage);
    if (actual > reservation.reservedMicros) {
      return finish({ state: "UNKNOWN", reconciledCeilingMicros: null,
        actualInputUnits: null, actualOutputUnits: null, settledAt: now });
    }
    return finish({ state: "SETTLED", reconciledCeilingMicros: actual,
      actualInputUnits: usage.inputUnits, actualOutputUnits: usage.outputUnits, settledAt: now });
  });
}

type RateSnapshot = {
  orgInputMicrosPerMillion: bigint; orgOutputMicrosPerMillion: bigint;
  projectInputMicrosPerMillion: bigint; projectOutputMicrosPerMillion: bigint;
};

function measuredCeiling(reservation: RateSnapshot, usage: { inputUnits: number; outputUnits: number }) {
  const calculate = (inputRate: bigint, outputRate: bigint) =>
    (BigInt(usage.inputUnits) * inputRate + BigInt(usage.outputUnits) * outputRate + BigInt(999_999)) / BigInt(1_000_000);
  const orgCeiling = calculate(reservation.orgInputMicrosPerMillion, reservation.orgOutputMicrosPerMillion);
  const projectCeiling = calculate(reservation.projectInputMicrosPerMillion, reservation.projectOutputMicrosPerMillion);
  return orgCeiling > projectCeiling ? orgCeiling : projectCeiling;
}

/** Owner assertion after independently checking an opaque provider receipt/refund ID. */
export async function resolveUnknownAiSpend(input: {
  organizationId: string; projectId: string; reservationId: string; ownerUserId: string;
  kind: "VERIFIED_USAGE" | "VERIFIED_NO_CHARGE";
  evidenceReference: string; inputUnits?: number; outputUnits?: number;
}) {
  const evidenceHash = crypto.createHash("sha256").update(input.evidenceReference.trim()).digest("hex");
  return db.$transaction(async (tx) => {
    await lockAiSpendScope(tx, input.organizationId, input.projectId);
    const membership = await tx.organizationMember.findUnique({
      where: { userId_organizationId: { userId: input.ownerUserId, organizationId: input.organizationId } },
      select: { role: true },
    });
    if (membership?.role !== "OWNER") throw new AiBudgetError("owner_required", "Only the organization owner can reconcile a hold.");
    const reservation = await tx.aiSpendReservation.findFirst({
      where: { id: input.reservationId, organizationId: input.organizationId, projectId: input.projectId },
    });
    const requestedInput = input.kind === "VERIFIED_USAGE" ? input.inputUnits : null;
    const requestedOutput = input.kind === "VERIFIED_USAGE" ? input.outputUnits : null;
    if (reservation?.state === "SETTLED" && reservation.resolutionKind === input.kind &&
        reservation.resolutionEvidenceHash === evidenceHash &&
        reservation.actualInputUnits === requestedInput && reservation.actualOutputUnits === requestedOutput) {
      return reservation;
    }
    if (!reservation || reservation.state !== "UNKNOWN") {
      throw new AiBudgetError("settlement_unavailable", "Only an unknown, completed provider attempt can be manually reconciled.");
    }
    const usage = input.kind === "VERIFIED_NO_CHARGE"
      ? { inputUnits: 0, outputUnits: 0 }
      : { inputUnits: input.inputUnits, outputUnits: input.outputUnits };
    if (!Number.isSafeInteger(usage.inputUnits) || !Number.isSafeInteger(usage.outputUnits) ||
        usage.inputUnits! < 0 || usage.outputUnits! < 0 ||
        usage.inputUnits! > reservation.estimatedInputUnits || usage.outputUnits! > reservation.maxOutputUnits) {
      throw new AiBudgetError("settlement_unavailable", "Verified provider units exceed the original reservation.");
    }
    const reconciledCeilingMicros = input.kind === "VERIFIED_NO_CHARGE"
      ? BigInt(0) : measuredCeiling(reservation, usage as { inputUnits: number; outputUnits: number });
    if (reconciledCeilingMicros > reservation.reservedMicros) {
      throw new AiBudgetError("settlement_unavailable", "Verified provider units exceed the original ceiling.");
    }
    const resolvedAt = new Date();
    const updatedCount = await tx.aiSpendReservation.updateMany({ where: { id: reservation.id, state: "UNKNOWN" }, data: {
      state: "SETTLED", reconciledCeilingMicros,
      actualInputUnits: input.kind === "VERIFIED_USAGE" ? usage.inputUnits : null,
      actualOutputUnits: input.kind === "VERIFIED_USAGE" ? usage.outputUnits : null,
      resolutionKind: input.kind, resolutionEvidenceHash: evidenceHash,
      resolvedByUserId: input.ownerUserId, resolvedAt, settledAt: resolvedAt,
    } });
    if (updatedCount.count !== 1) throw new AiBudgetError("settlement_unavailable", "Hold was already resolved.");
    const projectBudget = await tx.aiBudget.findFirst({ where: {
      organizationId: input.organizationId, projectId: input.projectId,
    }, select: { id: true } });
    if (!projectBudget) throw new AiBudgetError("budget_unavailable", "Project budget record is unavailable.");
    await tx.aiBudgetEvent.create({ data: {
      organizationId: input.organizationId, projectId: input.projectId,
      budgetId: projectBudget.id, kind: "MANUAL_SETTLEMENT", actorId: input.ownerUserId,
      periodKey: reservation.periodKey,
      snapshot: { reservationId: reservation.id, kind: input.kind, evidenceHash,
        inputUnits: input.kind === "VERIFIED_USAGE" ? usage.inputUnits : null,
        outputUnits: input.kind === "VERIFIED_USAGE" ? usage.outputUnits : null,
        reconciledCeilingMicros: reconciledCeilingMicros.toString() },
    } });
    return tx.aiSpendReservation.findUniqueOrThrow({ where: { id: reservation.id } });
  });
}
