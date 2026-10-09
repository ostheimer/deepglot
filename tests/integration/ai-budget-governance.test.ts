import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { db } from "@/lib/db";
import { reserveAiSpend, settleAiSpend, resolveUnknownAiSpend } from "@/lib/ai-budget";
import { preflightAiSpend } from "@/lib/ai-budget";

const databaseUrl = process.env.DEEPGLOT_BUDGET_TEST_DATABASE_URL;

async function waitForScopeLockWaiters(expected: number) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await db.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT count(*)::bigint AS waiting FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query LIKE '%"Organization"%'
        AND query LIKE '%FOR UPDATE%'
    `;
    if (Number(rows[0]?.waiting ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected ${expected} PostgreSQL scope-lock waiters`);
}

async function raceSettlements(organizationId: string, reservationId: string,
  firstUsage?: { inputUnits: number; outputUnits: number },
  secondUsage?: { inputUnits: number; outputUnits: number }) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let ready!: () => void;
  const acquired = new Promise<void>((resolve) => { ready = resolve; });
  const holder = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
    ready();
    await gate;
  }, { timeout: 10000 });
  let first: ReturnType<typeof settleAiSpend> | undefined;
  let second: ReturnType<typeof settleAiSpend> | undefined;
  try {
    await acquired;
    first = settleAiSpend(reservationId, firstUsage);
    await waitForScopeLockWaiters(1);
    second = settleAiSpend(reservationId, secondUsage);
    await waitForScopeLockWaiters(2);
    release();
    await holder;
    return await Promise.all([first, second]);
  } finally {
    release();
    await holder.catch(() => {});
    await Promise.allSettled([first, second].filter((item) => item !== undefined));
  }
}

test("parallel good then malformed settlement cannot reduce an UNKNOWN hold", { skip: !databaseUrl }, async () => {
  const id = crypto.randomUUID();
  await db.organization.create({ data: { id, name: "Settlement race fixture", slug: `settlement-${id}` } });
  try {
    const project = await db.project.create({ data: { id: `${id}-project`, name: "Settlement race",
      domain: `settlement-${id}.test`, organizationId: id } });
    for (const projectId of [null, project.id]) await db.aiBudget.create({ data: {
      organizationId: id, projectId, currency: "USD", capMicros: BigInt(5000),
      perCallCapMicros: BigInt(5000), warningPercent: 80, period: "MONTHLY_UTC",
      approvedByUserId: "fixture-owner", models: { create: [{ provider: "mock", model: "mock", unit: "TOKEN",
        inputMicrosPerMillion: BigInt(1000000), outputMicrosPerMillion: BigInt(1000000),
        maxInputUnits: 10000, maxOutputUnits: 100, priceExpiresAt: new Date(Date.now() + 86400000) }] },
    } });
    const createReservation = (suffix: string) => db.aiSpendReservation.create({ data: {
      organizationId: id, projectId: project.id, requestKeyHash: `race-${id}-${suffix}`,
      requestGroupHash: `race-group-${id}-${suffix}`, dispatchId: `${id}-${suffix}`, actorKind: "API_KEY", actorId: "fixture-key",
      action: "TRANSLATION", provider: "mock", model: "mock", currency: "USD",
      periodKey: new Date().getUTCFullYear() * 100 + new Date().getUTCMonth() + 1,
      state: "DISPATCHED", reservedMicros: BigInt(5000), estimatedInputUnits: 10000,
      maxOutputUnits: 100, orgInputMicrosPerMillion: BigInt(1000000),
      orgOutputMicrosPerMillion: BigInt(1000000), projectInputMicrosPerMillion: BigInt(1000000),
      projectOutputMicrosPerMillion: BigInt(1000000), unit: "TOKEN",
    } });
    const reservation = await createReservation("good-first");
    const [first, second] = await raceSettlements(id, reservation.id,
      { inputUnits: 1, outputUnits: 0 }, { inputUnits: -1, outputUnits: 0 });
    assert.equal(first.state, "SETTLED");
    assert.equal(second.state, "SETTLED");
    assert.equal(second.reconciledCeilingMicros, BigInt(1));
    const saved = await db.aiSpendReservation.findUniqueOrThrow({ where: { id: reservation.id } });
    assert.equal(saved.state, "SETTLED");
    assert.equal(saved.reconciledCeilingMicros, BigInt(1));
    const preflight = await preflightAiSpend({ organizationId: id, projectId: project.id,
      provider: "mock", model: "mock", inputUnits: 1, outputUnits: 0 });
    assert.equal(preflight.organizationRemainingMicros, "4999");
    await db.aiSpendReservation.delete({ where: { id: reservation.id } });

    const unknownFirst = await createReservation("unknown-first");
    const [unknown, lateGood] = await raceSettlements(id, unknownFirst.id,
      { inputUnits: -1, outputUnits: 0 }, { inputUnits: 1, outputUnits: 0 });
    assert.equal(unknown.state, "UNKNOWN");
    assert.equal(lateGood.state, "UNKNOWN");
    assert.equal(lateGood.reconciledCeilingMicros, null);
    const held = await preflightAiSpend({ organizationId: id, projectId: project.id,
      provider: "mock", model: "mock", inputUnits: 1, outputUnits: 0 });
    assert.equal(held.allowed, false);
    assert.equal(held.organizationRemainingMicros, "0");
    // Defensive readback also keeps the full hold for a legacy row whose
    // stale settlement once left a reduced ceiling attached to UNKNOWN.
    await db.aiSpendReservation.update({ where: { id: unknownFirst.id },
      data: { reconciledCeilingMicros: BigInt(1) } });
    const legacyUnknown = await preflightAiSpend({ organizationId: id, projectId: project.id,
      provider: "mock", model: "mock", inputUnits: 1, outputUnits: 0 });
    assert.equal(legacyUnknown.organizationRemainingMicros, "0");
    await db.aiSpendReservation.delete({ where: { id: unknownFirst.id } });

    const differingReceipts = await createReservation("different-good-receipts");
    const [original, conflicting] = await raceSettlements(id, differingReceipts.id,
      { inputUnits: 1, outputUnits: 0 }, { inputUnits: 2, outputUnits: 0 });
    assert.equal(original.state, "SETTLED");
    assert.equal(conflicting.state, "SETTLED");
    assert.equal(conflicting.actualInputUnits, 1);
    assert.equal(conflicting.reconciledCeilingMicros, BigInt(1));
    assert.equal(await db.aiSpendReservation.count({ where: { organizationId: id } }), 1);
  } finally {
    await db.organization.delete({ where: { id } });
  }
});

test("current-month foreign-currency UNKNOWN hold cannot be reinterpreted by new policy currency", { skip: !databaseUrl }, async () => {
  const id = crypto.randomUUID();
  await db.organization.create({ data: { id, name: "Currency fixture", slug: `currency-${id}` } });
  try {
    const project = await db.project.create({ data: { organizationId: id,
      name: "Currency project", domain: `currency-${id}.invalid` } });
    await db.projectLanguage.create({ data: { projectId: project.id, langCode: "en" } });
    const key = await db.apiKey.create({ data: { projectId: project.id, name: "fixture",
      key: crypto.randomBytes(32).toString("hex"), keyPrefix: "fixture" } });
    for (const projectId of [null, project.id]) await db.aiBudget.create({ data: {
      organizationId: id, projectId, currency: "USD", capMicros: BigInt(10000),
      perCallCapMicros: BigInt(5000), warningPercent: 80, period: "MONTHLY_UTC",
      approvedByUserId: "fixture-owner", models: { create: [{ provider: "mock", model: "mock",
        unit: "ZERO_COST", inputMicrosPerMillion: BigInt(0), outputMicrosPerMillion: BigInt(0),
        maxInputUnits: 10000, maxOutputUnits: 0, priceExpiresAt: new Date(Date.now() + 86400000) }] },
    } });
    const periodKey = new Date().getUTCFullYear() * 100 + new Date().getUTCMonth() + 1;
    const reservation = await db.aiSpendReservation.create({ data: {
      organizationId: id, projectId: project.id,
      requestKeyHash: `currency-${id}`, requestGroupHash: `currency-group-${id}`,
      dispatchId: id, actorKind: "API_KEY", actorId: key.id,
      action: "TRANSLATION", provider: "openai", model: "fixture", currency: "USD",
      periodKey, state: "UNKNOWN", reservedMicros: BigInt(4000),
      estimatedInputUnits: 1000, maxOutputUnits: 100, unit: "TOKEN",
      orgInputMicrosPerMillion: BigInt(1000000), orgOutputMicrosPerMillion: BigInt(1000000),
      projectInputMicrosPerMillion: BigInt(1000000), projectOutputMicrosPerMillion: BigInt(1000000),
    } });
    await db.aiBudget.updateMany({ where: { organizationId: id }, data: { currency: "EUR" } });
    await assert.rejects(() => preflightAiSpend({ organizationId: id, projectId: project.id,
      provider: "mock", model: "mock", inputUnits: 1, outputUnits: 0 }), { code: "budget_currency_conflict" });
    await assert.rejects(() => reserveAiSpend({ organizationId: id, projectId: project.id,
      requestGroupKey: `${id}:new-request`, requestKey: `${id}:new-attempt`, dispatchId: crypto.randomUUID(),
      actorKind: "API_KEY", actorId: key.id, action: "TRANSLATION", sourceLang: "de", targetLang: "en",
      expectedSettingsUpdatedAt: null, provider: "mock", model: "mock", input: { texts: ["Hallo"] } }),
    { code: "budget_currency_conflict" });
    assert.equal((await db.aiSpendReservation.findUniqueOrThrow({ where: { id: reservation.id } })).currency, "USD");
  } finally { await db.organization.delete({ where: { id } }); }
});

test("PostgreSQL budget admission is atomic across projects, retries and unknown receipts", { skip: !databaseUrl }, async () => {
  const id = crypto.randomUUID();
  const organization = await db.organization.create({ data: { id, name: "AI budget fixture", slug: `ai-budget-${id}` } });
  try {
    const projectA = await db.project.create({ data: { id: `${id}-a`, name: "A", domain: `a-${id}.test`, organizationId: id } });
    const projectB = await db.project.create({ data: { id: `${id}-b`, name: "B", domain: `b-${id}.test`, organizationId: id } });
    await db.projectLanguage.createMany({ data: [
      { projectId: projectA.id, langCode: "en" }, { projectId: projectB.id, langCode: "en" },
    ] });
    const keyA = await db.apiKey.create({ data: { id: `${id}-key-a`, projectId: projectA.id,
      name: "fixture A", key: crypto.randomBytes(32).toString("hex"), keyPrefix: "fixture" } });
    const keyB = await db.apiKey.create({ data: { id: `${id}-key-b`, projectId: projectB.id,
      name: "fixture B", key: crypto.randomBytes(32).toString("hex"), keyPrefix: "fixture" } });
    const expires = new Date(Date.now() + 86_400_000);
    for (const projectId of [null, projectA.id, projectB.id]) {
      await db.aiBudget.create({ data: {
        organizationId: id, projectId, currency: "USD", capMicros: projectId ? BigInt(10_000) : BigInt(5_000),
        perCallCapMicros: BigInt(5_000), warningPercent: 80, period: "MONTHLY_UTC",
        approvedByUserId: "fixture-owner",
        models: { create: [{ provider: "mock", model: "mock", unit: "TOKEN",
          inputMicrosPerMillion: BigInt(1_000_000), outputMicrosPerMillion: BigInt(1_000_000),
          maxInputUnits: 10_000, maxOutputUnits: 100, priceExpiresAt: expires }] },
      } });
    }
    const base = { organizationId: id, actorKind: "API_KEY" as const,
      action: "TRANSLATION", sourceLang: "de", targetLang: "en", expectedSettingsUpdatedAt: null,
      provider: "mock", model: "mock", input: { texts: ["Hallo"] } };
    const attempts = [projectA.id, projectB.id].map((projectId, i) => reserveAiSpend({
      ...base, projectId, actorId: i === 0 ? keyA.id : keyB.id, requestGroupKey: `${id}:request-${i}`,
      requestKey: `${id}:attempt-${i}`, dispatchId: crypto.randomUUID(),
    }));
    const outcomes = await Promise.allSettled(attempts);
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((result) => result.status === "rejected").length, 1);
    const winner = outcomes.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof reserveAiSpend>>> => result.status === "fulfilled")!.value;
    const winningProject = outcomes[0].status === "fulfilled" ? projectA.id : projectB.id;
    await assert.rejects(() => reserveAiSpend({ ...base, projectId: winningProject,
      actorId: winningProject === projectA.id ? keyA.id : keyB.id,
      requestGroupKey: `${id}:request-${outcomes[0].status === "fulfilled" ? 0 : 1}`,
      requestKey: `${id}:retry-new-attempt`, dispatchId: crypto.randomUUID() }), { code: "spend_already_dispatched" });
    const unknown = await settleAiSpend(winner.reservationId);
    assert.equal(unknown.state, "UNKNOWN");
    assert.equal(unknown.reconciledCeilingMicros, null);
    const rows = await db.aiSpendReservation.findMany({ where: { organizationId: id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reservedMicros.toString(), winner.reservedMicros);
    void organization;
  } finally {
    await db.organization.delete({ where: { id } });
  }
});

test("revoked API key at the delayed dispatch boundary is denied before reservation", { skip: !databaseUrl }, async () => {
  const id = crypto.randomUUID();
  await db.organization.create({ data: { id, name: "Revocation fixture", slug: `ai-budget-revoke-${id}` } });
  try {
    const project = await db.project.create({ data: { id: `${id}-project`, name: "Revocation project",
      domain: `revoke-${id}.test`, organizationId: id } });
    await db.projectLanguage.create({ data: { projectId: project.id, langCode: "en" } });
    const key = await db.apiKey.create({ data: { id: `${id}-key`, projectId: project.id, name: "fixture",
      key: crypto.randomBytes(32).toString("hex"), keyPrefix: "fixture" } });
    for (const projectId of [null, project.id]) {
      await db.aiBudget.create({ data: { organizationId: id, projectId,
        currency: "USD", capMicros: BigInt(10_000), perCallCapMicros: BigInt(10_000),
        warningPercent: 80, period: "MONTHLY_UTC", approvedByUserId: "fixture-owner",
        models: { create: [{ provider: "mock", model: "mock", unit: "TOKEN",
          inputMicrosPerMillion: BigInt(1_000_000), outputMicrosPerMillion: BigInt(1_000_000),
          maxInputUnits: 10_000, maxOutputUnits: 100,
          priceExpiresAt: new Date(Date.now() + 86_400_000) }] } } });
    }
    // Simulates a key validated at request entry, then revoked while earlier
    // cache/word-quota work delayed the final provider dispatch.
    await db.apiKey.update({ where: { id: key.id }, data: { isActive: false } });
    await assert.rejects(() => reserveAiSpend({ organizationId: id, projectId: project.id,
      requestGroupKey: `${id}:request`, requestKey: `${id}:attempt`, dispatchId: crypto.randomUUID(),
      actorKind: "API_KEY", actorId: key.id, action: "TRANSLATION",
      sourceLang: "de", targetLang: "en", expectedSettingsUpdatedAt: null,
      provider: "mock", model: "mock", input: { texts: ["Hallo"] } }),
    { code: "actor_revoked" });
    assert.equal(await db.aiSpendReservation.count({ where: { organizationId: id } }), 0);
  } finally { await db.organization.delete({ where: { id } }); }
});

test("only an owner can release UNKNOWN with an auditable verified reference", { skip: !databaseUrl }, async () => {
  const id = crypto.randomUUID();
  const user = await db.user.create({ data: { id: `${id}-user`, email: `${id}@fixture.invalid` } });
  await db.organization.create({ data: { id, name: "Manual review fixture", slug: `ai-budget-review-${id}` } });
  try {
    await db.organizationMember.create({ data: { organizationId: id, userId: user.id, role: "OWNER" } });
    const project = await db.project.create({ data: { id: `${id}-project`, name: "Manual review",
      domain: `review-${id}.test`, organizationId: id } });
    await db.projectLanguage.create({ data: { projectId: project.id, langCode: "en" } });
    const key = await db.apiKey.create({ data: { id: `${id}-key`, projectId: project.id,
      name: "fixture", key: crypto.randomBytes(32).toString("hex"), keyPrefix: "fixture" } });
    for (const projectId of [null, project.id]) await db.aiBudget.create({ data: {
      organizationId: id, projectId, currency: "USD", capMicros: BigInt(10_000),
      perCallCapMicros: BigInt(10_000), warningPercent: 80, period: "MONTHLY_UTC",
      approvedByUserId: user.id, models: { create: [{ provider: "mock", model: "mock", unit: "TOKEN",
        inputMicrosPerMillion: BigInt(1_000_000), outputMicrosPerMillion: BigInt(1_000_000),
        maxInputUnits: 10_000, maxOutputUnits: 100,
        priceExpiresAt: new Date(Date.now() + 86_400_000) }] },
    } });
    const approval = await reserveAiSpend({ organizationId: id, projectId: project.id,
      requestGroupKey: `${id}:request`, requestKey: `${id}:attempt`, dispatchId: crypto.randomUUID(),
      actorKind: "API_KEY", actorId: key.id, action: "TRANSLATION",
      sourceLang: "de", targetLang: "en", expectedSettingsUpdatedAt: null,
      provider: "mock", model: "mock", input: { texts: ["Hallo"] } });
    await assert.rejects(() => resolveUnknownAiSpend({ organizationId: id, projectId: project.id,
      reservationId: approval.reservationId, ownerUserId: user.id, kind: "VERIFIED_NO_CHARGE",
      evidenceReference: "credit-before-provider-completion" }), { code: "settlement_unavailable" });
    await settleAiSpend(approval.reservationId);
    const base = { organizationId: id, projectId: project.id, reservationId: approval.reservationId,
      ownerUserId: user.id, kind: "VERIFIED_USAGE" as const, evidenceReference: "provider-receipt-123" };
    await db.organizationMember.update({ where: { userId_organizationId: { userId: user.id, organizationId: id } },
      data: { role: "ADMIN" } });
    await assert.rejects(() => resolveUnknownAiSpend({ ...base, inputUnits: 1, outputUnits: 0 }), { code: "owner_required" });
    await db.organizationMember.update({ where: { userId_organizationId: { userId: user.id, organizationId: id } },
      data: { role: "OWNER" } });
    await assert.rejects(() => resolveUnknownAiSpend({ ...base, inputUnits: 100_000, outputUnits: 0 }),
      { code: "settlement_unavailable" });
    const [result, retry] = await Promise.all([
      resolveUnknownAiSpend({ ...base, inputUnits: 1, outputUnits: 0 }),
      resolveUnknownAiSpend({ ...base, inputUnits: 1, outputUnits: 0 }),
    ]);
    assert.equal(result.state, "SETTLED");
    assert.equal(result.reconciledCeilingMicros, BigInt(1));
    assert.equal(result.resolutionEvidenceHash, crypto.createHash("sha256").update(base.evidenceReference).digest("hex"));
    assert.equal(retry.id, result.id);
    assert.equal(await db.aiBudgetEvent.count({ where: { organizationId: id, kind: "MANUAL_SETTLEMENT" } }), 1);
    await assert.rejects(() => resolveUnknownAiSpend({ ...base, evidenceReference: "another-receipt-321",
      inputUnits: 1, outputUnits: 0 }),
      { code: "settlement_unavailable" });
  } finally {
    await db.organization.delete({ where: { id } });
    await db.user.delete({ where: { id: user.id } });
  }
});
