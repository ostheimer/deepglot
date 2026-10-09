import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { commitWorkspaceTransfer, previewWorkspaceTransfer } from "@/lib/workspace-transfer";

const databaseUrl = process.env.DEEPGLOT_BUDGET_TEST_DATABASE_URL;

async function fixture() {
  const id = crypto.randomUUID();
  const actor = await db.user.create({ data: { email: `${id}@fixture.invalid` } });
  const source = await db.organization.create({ data: { name: "Budget source", slug: `budget-source-${id}` } });
  const destination = await db.organization.create({ data: { name: "Budget destination", slug: `budget-destination-${id}`,
    plan: "STARTER", subscription: { create: { stripeCustomerId: `fixture-${id}`, status: "ACTIVE",
      plan: "STARTER", wordsLimit: 25_000 } } } });
  await db.organizationMember.createMany({ data: [source, destination].map((organization) => ({
    organizationId: organization.id, userId: actor.id, role: "OWNER" as const,
  })) });
  const project = await db.project.create({ data: { organizationId: source.id, name: "Budget project",
    domain: `budget-${id}.invalid`, languages: { create: { langCode: "en" } }, settings: { create: {} } } });
  const cleanup = async () => {
    await db.organization.deleteMany({ where: { id: { in: [source.id, destination.id] } } });
    await db.projectTransferAudit.deleteMany({ where: { projectId: project.id } });
    await db.user.delete({ where: { id: actor.id } });
  };
  return { id, actor, source, destination, project, cleanup };
}

async function reservation(item: Awaited<ReturnType<typeof fixture>>, state: "DISPATCHED" | "UNKNOWN" | "SETTLED",
  client: typeof db | Prisma.TransactionClient = db) {
  const periodKey = new Date().getUTCFullYear() * 100 + new Date().getUTCMonth() + 1;
  return client.aiSpendReservation.create({ data: {
    organizationId: item.source.id, projectId: item.project.id,
    requestKeyHash: `transfer-${item.id}`, requestGroupHash: `transfer-group-${item.id}`,
    dispatchId: item.id, actorKind: "USER", actorId: item.actor.id,
    action: "TRANSLATION", provider: "mock", model: "mock", currency: "USD",
    periodKey, state, reservedMicros: BigInt(5000),
    reconciledCeilingMicros: state === "SETTLED" ? BigInt(1000) : null,
    estimatedInputUnits: 5000, maxOutputUnits: 0,
    orgInputMicrosPerMillion: BigInt(1000000), orgOutputMicrosPerMillion: BigInt(1000000),
    projectInputMicrosPerMillion: BigInt(1000000), projectOutputMicrosPerMillion: BigInt(1000000),
    actualInputUnits: state === "SETTLED" ? 1000 : null,
    actualOutputUnits: state === "SETTLED" ? 0 : null, unit: "TOKEN",
  } });
}

async function waitForTransferLockWaiter() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const rows = await db.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT count(*)::bigint AS waiting FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query LIKE '%"Organization"%' AND query LIKE '%FOR UPDATE%'`;
    if (Number(rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected transfer to wait on the organization lock");
}

function commitInput(item: Awaited<ReturnType<typeof fixture>>,
  preview: Awaited<ReturnType<typeof previewWorkspaceTransfer>>) {
  return { actorUserId: item.actor.id, projectId: item.project.id,
    destinationId: item.destination.id, fingerprint: preview.fingerprint,
    issuedAt: preview.issuedAt, confirmationToken: preview.confirmationToken };
}

test("DISPATCHED and UNKNOWN spend block transfer preview and an already issued commit", { skip: !databaseUrl }, async () => {
  for (const state of ["DISPATCHED", "UNKNOWN"] as const) {
    const item = await fixture();
    try {
      const preview = await previewWorkspaceTransfer(item.actor.id, item.project.id, item.destination.id);
      const spend = await reservation(item, state);
      await assert.rejects(() => previewWorkspaceTransfer(item.actor.id, item.project.id, item.destination.id),
        { code: "PENDING" });
      await assert.rejects(() => commitWorkspaceTransfer(commitInput(item, preview)), { code: "PENDING" });
      assert.equal((await db.project.findUniqueOrThrow({ where: { id: item.project.id } })).organizationId, item.source.id);
      assert.equal((await db.aiSpendReservation.findUniqueOrThrow({ where: { id: spend.id } })).organizationId, item.source.id);
    } finally { await item.cleanup(); }
  }
});

test("settled spend and approval audit retain source ownership while target requires a new project approval", { skip: !databaseUrl }, async () => {
  const item = await fixture();
  try {
    const sourceBudget = await db.aiBudget.create({ data: { organizationId: item.source.id,
      projectId: item.project.id, currency: "USD", capMicros: BigInt(10000),
      perCallCapMicros: BigInt(5000), warningPercent: 80, period: "MONTHLY_UTC",
      approvedByUserId: item.actor.id } });
    const event = await db.aiBudgetEvent.create({ data: { organizationId: item.source.id,
      projectId: item.project.id, budgetId: sourceBudget.id, kind: "APPROVED", revision: 1,
      actorId: item.actor.id, snapshot: { currency: "USD", capMicros: "10000" } } });
    const settled = await reservation(item, "SETTLED");
    const preview = await previewWorkspaceTransfer(item.actor.id, item.project.id, item.destination.id);
    await commitWorkspaceTransfer(commitInput(item, preview));
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: item.project.id } })).organizationId, item.destination.id);
    assert.equal((await db.aiSpendReservation.findUniqueOrThrow({ where: { id: settled.id } })).organizationId, item.source.id);
    assert.equal(await db.aiBudget.findUnique({ where: { id: sourceBudget.id } }), null);
    assert.equal((await db.aiBudgetEvent.findUniqueOrThrow({ where: { id: event.id } })).organizationId, item.source.id);
    const destinationBudget = await db.aiBudget.create({ data: { organizationId: item.destination.id,
      projectId: item.project.id, currency: "USD", capMicros: BigInt(10000),
      perCallCapMicros: BigInt(5000), warningPercent: 80, period: "MONTHLY_UTC",
      approvedByUserId: item.actor.id } });
    assert.equal(destinationBudget.organizationId, item.destination.id);
  } finally { await item.cleanup(); }
});

test("commit rechecks spend after a concurrent dispatch releases the shared lock", { skip: !databaseUrl }, async () => {
  const item = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let ready!: () => void;
  const locked = new Promise<void>((resolve) => { ready = resolve; });
  try {
    const preview = await previewWorkspaceTransfer(item.actor.id, item.project.id, item.destination.id);
    const writer = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${item.source.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${item.project.id} FOR UPDATE`;
      ready();
      await gate;
      await reservation(item, "DISPATCHED", tx);
    }, { timeout: 20000 });
    await locked;
    const transfer = commitWorkspaceTransfer(commitInput(item, preview));
    try {
      await waitForTransferLockWaiter();
    } finally { release(); }
    await writer;
    await assert.rejects(transfer, { code: "PENDING" });
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: item.project.id } })).organizationId, item.source.id);
  } finally {
    release?.();
    await item.cleanup();
  }
});

async function commitBehindWriter(item: Awaited<ReturnType<typeof fixture>>,
  write: (tx: Prisma.TransactionClient) => Promise<void>, lockOrganizationId = item.source.id) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let ready!: () => void;
  const locked = new Promise<void>((resolve) => { ready = resolve; });
  const preview = await previewWorkspaceTransfer(item.actor.id, item.project.id, item.destination.id);
  const writer = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${lockOrganizationId} FOR UPDATE`;
    if (lockOrganizationId === item.source.id) {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${item.project.id} FOR UPDATE`;
    }
    ready();
    await gate;
    await write(tx);
  }, { timeout: 20_000 });
  await locked;
  const transfer = commitWorkspaceTransfer(commitInput(item, preview));
  try { await waitForTransferLockWaiter(); } finally { release(); }
  await writer;
  return transfer;
}

test("a provider-pending URL claim committed while transfer waits blocks transfer", { skip: !databaseUrl }, async () => {
  const item = await fixture();
  try {
    const url = await db.translatedUrl.create({ data: { projectId: item.project.id,
      urlPath: "/pending", langTo: "en" } });
    await assert.rejects(commitBehindWriter(item, async (tx) => {
      await tx.translatedUrl.update({ where: { id: url.id }, data: {
        operationState: "provider_pending", operationToken: item.id, lastOperationAt: new Date(),
      } });
    }), { code: "PENDING" });
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: item.project.id } })).organizationId, item.source.id);
  } finally { await item.cleanup(); }
});

for (const workspace of ["source", "destination"] as const) {
  test(`${workspace} role downgrade committed while transfer waits revokes transfer authority`,
    { skip: !databaseUrl }, async () => {
      const item = await fixture();
      try {
        await assert.rejects(commitBehindWriter(item, async (tx) => {
          await tx.organizationMember.update({ where: { userId_organizationId: {
            userId: item.actor.id, organizationId: item[workspace].id,
          } }, data: { role: "MEMBER" } });
        }, item[workspace].id), { code: "NOT_FOUND" });
        assert.equal((await db.project.findUniqueOrThrow({ where: { id: item.project.id } })).organizationId, item.source.id);
      } finally { await item.cleanup(); }
    });
}

test("a legacy receipt committed while transfer waits blocks originless billing history", { skip: !databaseUrl }, async () => {
  const item = await fixture();
  try {
    await assert.rejects(commitBehindWriter(item, async (tx) => {
      await tx.urlOperationReceipt.create({ data: {
        id: item.id, projectId: item.project.id, urlId: item.id, actorId: item.actor.id,
        urlPath: "/legacy", langTo: "en", billedWords: 1, segmentCount: 1,
        totalEligibleSegments: 1, remainingSegments: 0,
      } });
    }), { code: "UNATTRIBUTED" });
  } finally { await item.cleanup(); }
});

test("a newly attributed receipt committed while transfer waits invalidates the preview fingerprint", { skip: !databaseUrl }, async () => {
  const item = await fixture();
  try {
    await assert.rejects(commitBehindWriter(item, async (tx) => {
      await tx.urlOperationReceipt.create({ data: {
        id: item.id, projectId: item.project.id, originatingOrganizationId: item.source.id,
        urlId: item.id, actorId: item.actor.id, urlPath: "/receipt", langTo: "en",
        billedWords: 1, segmentCount: 1, totalEligibleSegments: 1, remainingSegments: 0,
      } });
    }), { code: "STALE" });
  } finally { await item.cleanup(); }
});

test("destination project creation committed while transfer waits enforces the current plan capacity", { skip: !databaseUrl }, async () => {
  const item = await fixture();
  try {
    await assert.rejects(commitBehindWriter(item, async (tx) => {
      for (const index of [1, 2]) {
        await tx.project.create({ data: { organizationId: item.destination.id,
          name: `Capacity ${index}`, domain: `capacity-${index}-${item.id}.invalid` } });
      }
    }, item.destination.id), { code: "LIMIT" });
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: item.project.id } })).organizationId, item.source.id);
  } finally { await item.cleanup(); }
});
