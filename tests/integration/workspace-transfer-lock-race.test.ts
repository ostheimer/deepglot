import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { commitWorkspaceTransfer, previewWorkspaceTransfer } from "@/lib/workspace-transfer";

after(async () => { await db.$disconnect(); });

async function fixture() {
  const id = randomUUID();
  const actor = await db.user.create({ data: { email: `transfer-race-${id}@example.invalid` } });
  const guardian = await db.user.create({ data: { email: `transfer-race-guardian-${id}@example.invalid` } });
  const source = await db.organization.create({ data: { name: "Race source", slug: `race-source-${id}` } });
  const destination = await db.organization.create({ data: { name: "Race destination", slug: `race-destination-${id}`,
    plan: "STARTER", subscription: { create: { stripeCustomerId: `fixture-${id}`, status: "ACTIVE",
      plan: "STARTER", wordsLimit: 25_000 } } } });
  await db.organizationMember.createMany({ data: [source, destination].flatMap((organization) =>
    [actor, guardian].map((user) => ({ organizationId: organization.id, userId: user.id, role: "OWNER" as const }))) });
  const project = await db.project.create({ data: { organizationId: source.id, name: "Race project",
    domain: `race-${id}.invalid`, languages: { create: { langCode: "en" } }, settings: { create: {} } } });
  const cleanup = async () => {
    await db.organization.deleteMany({ where: { id: { in: [source.id, destination.id] } } });
    await db.projectTransferAudit.deleteMany({ where: { projectId: project.id } });
    await db.user.deleteMany({ where: { id: { in: [actor.id, guardian.id] } } });
  };
  return { id, actor, source, destination, project, cleanup };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function waitForTransferLockWaiter() {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const rows = await db.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT count(*)::bigint AS waiting FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query LIKE '%"Organization"%' AND query LIKE '%FOR UPDATE%'`;
    if (Number(rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected transfer to wait on the organization lock");
}

async function commitBehindWriter(item: Fixture,
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
  const transfer = commitWorkspaceTransfer({ actorUserId: item.actor.id, projectId: item.project.id,
    destinationId: item.destination.id, fingerprint: preview.fingerprint,
    issuedAt: preview.issuedAt, confirmationToken: preview.confirmationToken });
  try { await waitForTransferLockWaiter(); } finally { release(); }
  await writer;
  return transfer;
}

test("a provider-pending URL claim committed while transfer waits blocks transfer", async () => {
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
  test(`${workspace} role downgrade committed while transfer waits revokes transfer authority`, async () => {
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

test("a legacy receipt committed while transfer waits blocks originless billing history", async () => {
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

test("a newly attributed receipt committed while transfer waits invalidates the preview fingerprint", async () => {
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

test("destination project creation committed while transfer waits enforces current capacity", async () => {
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
