import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiBudgetPolicyInput } from "@/lib/ai-budget-policy";
import { currentAiBudgetEnforcementState } from "@/lib/ai-budget-enforcement";
import { assertAiSpendLedgerCurrency, lockAiSpendScope, preflightAiSpend,
  readAiSpendTotals, resolveUnknownAiSpend } from "@/lib/ai-budget";
import { AiBudgetError, utcPeriodKey } from "@/lib/ai-budget-math";
import { userCanManageProject } from "@/lib/project-access";
import { z } from "zod";

export const runtime = "nodejs";

async function context(projektId: string) {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!(await userCanManageProject(session.user.id, projektId))) return null;
  const project = await db.project.findUnique({ where: { id: projektId }, select: { organizationId: true } });
  return project ? { userId: session.user.id, organizationId: project.organizationId } : null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ projektId: string }> }) {
  const { projektId } = await params;
  const access = await context(projektId);
  if (!access) return NextResponse.json({ code: "not_found" }, { status: 404 });
  const enforcementState = currentAiBudgetEnforcementState();
  const budgets = await db.aiBudget.findMany({
    where: { organizationId: access.organizationId, OR: [{ projectId: null }, { projectId: projektId }] },
    include: { models: true },
  });
  const periodKey = utcPeriodKey(new Date());
  const organizationBudget = budgets.find((item) => item.projectId === null);
  const projectBudget = budgets.find((item) => item.projectId === projektId);
  let spend: Awaited<ReturnType<typeof readAiSpendTotals>>;
  try {
    spend = await readAiSpendTotals(db, access.organizationId, projektId, periodKey,
      organizationBudget?.currency ?? projectBudget?.currency ?? null);
    if (spend.rowCount > BigInt(0) && organizationBudget && projectBudget &&
        organizationBudget.currency !== projectBudget.currency) {
      throw new AiBudgetError("budget_currency_conflict", "Current-period spend cannot be shown under conflicting policy currencies.");
    }
  } catch (error) {
    if (error instanceof AiBudgetError) return NextResponse.json({ code: error.code,
      detail: error.message, enforcementState }, { status: 409 });
    return NextResponse.json({ code: "budget_unavailable" }, { status: 503 });
  }
  const events = await db.aiBudgetEvent.findMany({
    where: { organizationId: access.organizationId, OR: [{ projectId: null }, { projectId: projektId }] },
    orderBy: { createdAt: "desc" }, take: 20,
    select: { id: true, budgetId: true, kind: true, periodKey: true,
      threshold: true, actorId: true, revision: true, snapshot: true, createdAt: true },
  });
  const recentSpend = await db.aiSpendReservation.findMany({
    where: { projectId: projektId, organizationId: access.organizationId },
    orderBy: { dispatchedAt: "desc" }, take: 20,
    select: { id: true, action: true, provider: true, model: true, currency: true,
      state: true, unit: true, estimatedInputUnits: true, maxOutputUnits: true, actualInputUnits: true,
      actualOutputUnits: true, reservedMicros: true, reconciledCeilingMicros: true,
      resolutionKind: true, resolvedAt: true, periodKey: true, dispatchedAt: true, settledAt: true },
  });
  const serialize = (projectId: string | null) => {
    const budget = budgets.find((item) => item.projectId === projectId);
    if (!budget) return null;
    return {
      id: budget.id, revision: budget.revision, scope: projectId ? "project" : "organization",
      currency: budget.currency, capMicros: budget.capMicros.toString(),
      perCallCapMicros: budget.perCallCapMicros.toString(), warningPercent: budget.warningPercent,
      period: budget.period, approvedAt: budget.approvedAt.toISOString(),
      models: budget.models.map((model) => ({
        provider: model.provider, model: model.model, unit: model.unit,
        inputMicrosPerMillion: model.inputMicrosPerMillion.toString(),
        outputMicrosPerMillion: model.outputMicrosPerMillion.toString(),
        maxInputUnits: model.maxInputUnits, maxOutputUnits: model.maxOutputUnits,
        outputCapVerified: model.outputCapVerified,
        priceExpiresAt: model.priceExpiresAt.toISOString(),
      })),
    };
  };
  return NextResponse.json({
    organization: serialize(null), project: serialize(projektId), periodKey, enforcementState,
    organizationCommittedMicros: enforcementState === "active" ? spend.organizationMicros.toString() : null,
    projectCommittedMicros: enforcementState === "active" ? spend.projectMicros.toString() : null,
    events,
    recentSpend: recentSpend.map((item) => ({ ...item,
      reservedMicros: item.reservedMicros.toString(),
      reconciledCeilingMicros: item.reconciledCeilingMicros?.toString() ?? null })),
    wordQuotaIsSeparate: true, platformCreditsIncluded: false,
  });
}

const manualSettlementInput = z.object({
  reservationId: z.string().min(1),
  kind: z.enum(["VERIFIED_USAGE", "VERIFIED_NO_CHARGE"]),
  // Opaque provider receipt/credit reference only; the server stores its hash.
  evidenceReference: z.string().regex(/^[A-Za-z0-9_.:-]{3,128}$/),
  inputUnits: z.number().int().min(0).optional(),
  outputUnits: z.number().int().min(0).optional(),
}).superRefine((input, ctx) => {
  if (input.kind === "VERIFIED_USAGE" && (input.inputUnits === undefined || input.outputUnits === undefined)) {
    ctx.addIssue({ code: "custom", message: "Verified provider units are required." });
  }
  if (input.kind === "VERIFIED_NO_CHARGE" && (input.inputUnits !== undefined || input.outputUnits !== undefined)) {
    ctx.addIssue({ code: "custom", message: "No-charge confirmation does not accept usage units." });
  }
});

/** Manual, audited release of an UNKNOWN hold; DISPATCHED is never released here. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ projektId: string }> }) {
  const { projektId } = await params;
  const access = await context(projektId);
  if (!access) return NextResponse.json({ code: "not_found" }, { status: 404 });
  const parsed = manualSettlementInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "invalid_settlement" }, { status: 400 });
  try {
    const result = await resolveUnknownAiSpend({ organizationId: access.organizationId,
      projectId: projektId, ownerUserId: access.userId, ...parsed.data });
    return NextResponse.json({ id: result.id, state: result.state,
      reconciledCeilingMicros: result.reconciledCeilingMicros?.toString() ?? null });
  } catch (error) {
    if (error instanceof AiBudgetError) return NextResponse.json({ code: error.code },
      { status: error.code === "owner_required" ? 403 : 409 });
    return NextResponse.json({ code: "budget_unavailable" }, { status: 503 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ projektId: string }> }) {
  const { projektId } = await params;
  const access = await context(projektId);
  if (!access) return NextResponse.json({ code: "not_found" }, { status: 404 });
  const parsed = aiBudgetPolicyInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "invalid_budget", issues: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  try {
    const result = await db.$transaction(async (tx) => {
      await lockAiSpendScope(tx, access.organizationId, projektId);
      // Recheck the role under the same organization row lock used by transfer
      // and spend admission; a revoked owner cannot race an approval through.
      const membership = await tx.organizationMember.findUnique({
        where: { userId_organizationId: { userId: access.userId, organizationId: access.organizationId } },
        select: { role: true },
      });
      if (membership?.role !== "OWNER") return { kind: "forbidden" } as const;
      // The organization row lock serializes this approval against dispatch.
      // An existing current-month reservation has immutable currency and no
      // approved exchange rate, even when both policies are changed together.
      await assertAiSpendLedgerCurrency(tx, access.organizationId, utcPeriodKey(new Date()), input.currency);
      const projectId = input.scope === "project" ? projektId : null;
      const existing = await tx.aiBudget.findFirst({ where: { organizationId: access.organizationId, projectId } });
      const approvedAt = new Date();
      const budget = existing
        ? await tx.aiBudget.update({
            where: { id: existing.id },
            data: { currency: input.currency, capMicros: BigInt(input.capMicros),
              perCallCapMicros: BigInt(input.perCallCapMicros), warningPercent: input.warningPercent,
              period: input.period, approvedByUserId: access.userId, approvedAt,
              revision: { increment: 1 } },
          })
        : await tx.aiBudget.create({
            data: { organizationId: access.organizationId, projectId,
              currency: input.currency, capMicros: BigInt(input.capMicros),
              perCallCapMicros: BigInt(input.perCallCapMicros), warningPercent: input.warningPercent,
              period: input.period, approvedByUserId: access.userId, approvedAt },
          });
      await tx.aiBudgetModel.deleteMany({ where: { budgetId: budget.id } });
      await tx.aiBudgetModel.createMany({
        data: input.models.map((model) => ({ id: crypto.randomUUID(), budgetId: budget.id,
          provider: model.provider, model: model.model, unit: model.unit,
          inputMicrosPerMillion: BigInt(model.inputMicrosPerMillion),
          outputMicrosPerMillion: BigInt(model.outputMicrosPerMillion),
          maxInputUnits: model.maxInputUnits, maxOutputUnits: model.maxOutputUnits,
          outputCapVerified: model.outputCapVerified,
          priceExpiresAt: new Date(model.priceExpiresAt), approvedAt })),
      });
      await tx.aiBudgetEvent.create({
        data: { organizationId: access.organizationId, projectId, budgetId: budget.id,
          kind: "APPROVED", actorId: access.userId, revision: budget.revision,
          snapshot: input },
      });
      return { kind: "approved", scope: input.scope, revision: budget.revision } as const;
    });
    if (result.kind === "forbidden") return NextResponse.json({ code: "owner_required" }, { status: 403 });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AiBudgetError) return NextResponse.json({ code: error.code,
      detail: error.message }, { status: 409 });
    return NextResponse.json({ code: "budget_unavailable" }, { status: 503 });
  }
}

const preflightInput = z.object({
  action: z.enum(["TRANSLATION", "CONTEXT_TRANSLATION", "BULK_TRANSLATION", "AI_EDIT", "REWRITE", "IMPROVE"]),
  provider: z.string().min(1).max(80), model: z.string().min(1).max(160),
  inputUnits: z.number().int().min(0).max(10_000_000),
  outputUnits: z.number().int().min(0).max(100_000),
});

/** Read-only, bounded estimate; the dispatcher still makes the final decision. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ projektId: string }> }) {
  const { projektId } = await params;
  const access = await context(projektId);
  if (!access) return NextResponse.json({ code: "not_found" }, { status: 404 });
  const enforcementState = currentAiBudgetEnforcementState();
  const parsed = preflightInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "invalid_preflight" }, { status: 400 });
  try {
    const result = await preflightAiSpend({
      organizationId: access.organizationId, projectId: projektId,
      provider: parsed.data.provider, model: parsed.data.model,
      inputUnits: parsed.data.inputUnits, outputUnits: parsed.data.outputUnits,
    });
    return NextResponse.json({ ...result,
      allowed: enforcementState === "active" ? result.allowed : null,
      wouldBeAllowedIfActivated: result.allowed,
      code: enforcementState === "active" ? result.code : "preparation_estimate",
      note: enforcementState === "inactive"
        ? "Preparation estimate only. AI budget enforcement is inactive; current provider calls do not reserve against this policy."
        : result.note,
      action: parsed.data.action, enforcementState,
      previewOnly: enforcementState === "inactive" });
  } catch (error) {
    if (error instanceof AiBudgetError) return NextResponse.json({ code: error.code, detail: error.message,
      enforcementState, previewOnly: enforcementState === "inactive" }, { status: 409 });
    return NextResponse.json({ code: "budget_unavailable" }, { status: 503 });
  }
}
