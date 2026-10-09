import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { db } from "@/lib/db";
import { preflightAiSpend, reserveAiSpend } from "@/lib/ai-budget";
import { deleteProjectWithAiSpendGuard } from "@/lib/ai-budget-project-deletion";

const databaseUrl = process.env.DEEPGLOT_BUDGET_TEST_DATABASE_URL;

async function waitForScopeWaiters(expected: number) {
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

async function fixture(state: "SETTLED" | "UNKNOWN" | "DISPATCHED") {
  const id = crypto.randomUUID();
  const user = await db.user.create({ data: { id: `${id}-user`, email: `${id}@fixture.invalid` } });
  await db.organization.create({ data: { id, name: "Ledger deletion fixture", slug: `ledger-delete-${id}` } });
  await db.organizationMember.create({ data: { organizationId: id, userId: user.id, role: "OWNER" } });
  const source = await db.project.create({ data: { id: `${id}-source`, name: "Source",
    domain: `source-${id}.test`, organizationId: id } });
  const sibling = await db.project.create({ data: { id: `${id}-sibling`, name: "Sibling",
    domain: `sibling-${id}.test`, organizationId: id } });
  await db.projectLanguage.create({ data: { projectId: source.id, langCode: "en" } });
  for (const projectId of [null, source.id, sibling.id]) await db.aiBudget.create({ data: {
    organizationId: id, projectId, currency: "USD", capMicros: BigInt(5000),
    perCallCapMicros: BigInt(5000), warningPercent: 80, period: "MONTHLY_UTC",
    approvedByUserId: user.id, models: { create: [{ provider: "mock", model: "mock", unit: "TOKEN",
      inputMicrosPerMillion: BigInt(1000000), outputMicrosPerMillion: BigInt(1000000),
      maxInputUnits: 10000, maxOutputUnits: 100, priceExpiresAt: new Date(Date.now() + 86400000) }] },
  } });
  const periodKey = new Date().getUTCFullYear() * 100 + new Date().getUTCMonth() + 1;
  const reservation = await db.aiSpendReservation.create({ data: {
    organizationId: id, projectId: source.id, requestKeyHash: `delete-${id}`,
    requestGroupHash: `delete-group-${id}`, dispatchId: id, actorKind: "USER", actorId: user.id,
    action: "TRANSLATION", provider: "mock", model: "mock", currency: "USD",
    periodKey, state, reservedMicros: BigInt(5000),
    reconciledCeilingMicros: state === "SETTLED" ? BigInt(1000) : null,
    estimatedInputUnits: 5000, maxOutputUnits: 0,
    orgInputMicrosPerMillion: BigInt(1000000), orgOutputMicrosPerMillion: BigInt(1000000),
    projectInputMicrosPerMillion: BigInt(1000000), projectOutputMicrosPerMillion: BigInt(1000000),
    actualInputUnits: state === "SETTLED" ? 1000 : null,
    actualOutputUnits: state === "SETTLED" ? 0 : null, unit: "TOKEN",
  } });
  return { id, user, source, sibling, reservation, cleanup: async () => {
    await db.organization.delete({ where: { id } });
    await db.user.delete({ where: { id: user.id } });
  } };
}

test("settled provider ledger survives project deletion and still consumes sibling organization cap", { skip: !databaseUrl }, async () => {
  const item = await fixture("SETTLED");
  try {
    await deleteProjectWithAiSpendGuard(item.source.id, item.user.id);
    const historical = await db.aiSpendReservation.findUnique({ where: { id: item.reservation.id } });
    assert.equal(historical?.projectId, item.source.id);
    assert.equal(historical?.organizationId, item.id);
    const estimate = await preflightAiSpend({ organizationId: item.id, projectId: item.sibling.id,
      provider: "mock", model: "mock", inputUnits: 1, outputUnits: 0 });
    assert.equal(estimate.organizationRemainingMicros, "4000");
  } finally { await item.cleanup(); }
});

test("UNKNOWN and DISPATCHED provider work blocks project deletion", { skip: !databaseUrl }, async () => {
  for (const state of ["UNKNOWN", "DISPATCHED"] as const) {
    const item = await fixture(state);
    try {
      await assert.rejects(() => deleteProjectWithAiSpendGuard(item.source.id, item.user.id),
        { code: "ai_spend_pending" });
      assert.ok(await db.project.findUnique({ where: { id: item.source.id } }));
      assert.ok(await db.aiSpendReservation.findUnique({ where: { id: item.reservation.id } }));
    } finally { await item.cleanup(); }
  }
});

test("role revocation before locked deletion is rechecked", { skip: !databaseUrl }, async () => {
  const item = await fixture("SETTLED");
  try {
    await db.organizationMember.update({ where: { userId_organizationId: {
      userId: item.user.id, organizationId: item.id,
    } }, data: { role: "MEMBER" } });
    await assert.rejects(() => deleteProjectWithAiSpendGuard(item.source.id, item.user.id),
      { code: "actor_revoked" });
    assert.ok(await db.project.findUnique({ where: { id: item.source.id } }));
  } finally { await item.cleanup(); }
});

test("reservation and project deletion serialize in both lock orders", { skip: !databaseUrl }, async () => {
  for (const reservationFirst of [true, false]) {
    const item = await fixture("SETTLED");
    try {
      await db.aiSpendReservation.delete({ where: { id: item.reservation.id } });
      const key = await db.apiKey.create({ data: { id: `${item.id}-key`, projectId: item.source.id,
        name: "fixture", key: crypto.randomBytes(32).toString("hex"), keyPrefix: "fixture" } });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let ready!: () => void;
      const acquired = new Promise<void>((resolve) => { ready = resolve; });
      const holder = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${item.id} FOR UPDATE`;
        ready();
        await gate;
      }, { timeout: 10000 });
      let reserve: ReturnType<typeof reserveAiSpend> | undefined;
      let deletion: ReturnType<typeof deleteProjectWithAiSpendGuard> | undefined;
      try {
        await acquired;
        const startReservation = () => reserveAiSpend({ organizationId: item.id,
          projectId: item.source.id, requestGroupKey: `${item.id}:request`,
          requestKey: `${item.id}:attempt`, dispatchId: crypto.randomUUID(),
          actorKind: "API_KEY", actorId: key.id, action: "TRANSLATION",
          sourceLang: "de", targetLang: "en", expectedSettingsUpdatedAt: null,
          provider: "mock", model: "mock", input: { texts: ["Hallo"] } });
        const startDeletion = () => deleteProjectWithAiSpendGuard(item.source.id, item.user.id);
        if (reservationFirst) reserve = startReservation();
        else deletion = startDeletion();
        await waitForScopeWaiters(1);
        if (reservationFirst) deletion = startDeletion();
        else reserve = startReservation();
        await waitForScopeWaiters(2);
        release();
        await holder;
        const [spendResult, deleteResult] = await Promise.allSettled([reserve!, deletion!]);
        if (reservationFirst) {
          assert.equal(spendResult.status, "fulfilled");
          assert.equal(deleteResult.status, "rejected");
          if (deleteResult.status === "rejected") assert.equal(deleteResult.reason.code, "ai_spend_pending");
          assert.ok(await db.project.findUnique({ where: { id: item.source.id } }));
          assert.equal(await db.aiSpendReservation.count({ where: { projectId: item.source.id, state: "DISPATCHED" } }), 1);
        } else {
          assert.equal(deleteResult.status, "fulfilled");
          assert.equal(spendResult.status, "rejected");
          if (spendResult.status === "rejected") assert.equal(spendResult.reason.code, "project_changed");
          assert.equal(await db.project.findUnique({ where: { id: item.source.id } }), null);
          assert.equal(await db.aiSpendReservation.count({ where: { projectId: item.source.id } }), 0);
        }
      } finally {
        release();
        await holder.catch(() => {});
        await Promise.allSettled([reserve, deletion].filter((promise) => promise !== undefined));
      }
    } finally { await item.cleanup(); }
  }
});
