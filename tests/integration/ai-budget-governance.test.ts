import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { db } from "@/lib/db";
import { reserveAiSpend, settleAiSpend, resolveUnknownAiSpend } from "@/lib/ai-budget";

const databaseUrl = process.env.DEEPGLOT_BUDGET_TEST_DATABASE_URL;

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
