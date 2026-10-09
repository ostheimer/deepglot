import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db } from "@/lib/db";
import { getUsageMonthKey, incrementUsageRecord, recordTranslationBatch } from "@/lib/translation-batches";
import { previewWorkspaceTransfer, commitWorkspaceTransfer } from "@/lib/workspace-transfer";
import { canManageProjectForWrite } from "@/lib/project-access";

test("workspace transfer checks both owners, preserves history and content, and revokes source access", async () => {
  const suffix = randomUUID();
  const users = await Promise.all(["actor", "source", "dest", "translator"].map((label) =>
    db.user.create({ data: { email: `${label}-${suffix}@example.invalid` } })));
  const [actor, sourceUser, destUser, translator] = users;
  const source = await db.organization.create({ data: { name: "Source", slug: `source-${suffix}`, plan: "STARTER" } });
  const destination = await db.organization.create({ data: { name: "Destination", slug: `dest-${suffix}`, plan: "STARTER",
    subscription: { create: { stripeCustomerId: `fixture-${suffix}`, status: "ACTIVE", plan: "STARTER", wordsLimit: 25_000 } } } });
  const project = await db.project.create({ data: { organizationId: source.id, name: "Fixture", domain: `${suffix}.invalid`,
    languages: { create: { langCode: "en" } }, settings: { create: { translationApiKeyEncrypted: "fixture-ciphertext" } } } });
  try {
    await db.organizationMember.createMany({ data: [
      { userId: actor.id, organizationId: source.id, role: "OWNER" },
      { userId: actor.id, organizationId: destination.id, role: "ADMIN" },
      { userId: sourceUser.id, organizationId: source.id, role: "ADMIN" },
      { userId: destUser.id, organizationId: destination.id, role: "MEMBER" },
    ] });
    const sourceMember = await db.projectMember.create({ data: { projectId: project.id, userId: sourceUser.id, email: sourceUser.email, role: "ADMIN" } });
    const destMember = await db.projectMember.create({ data: { projectId: project.id, userId: destUser.id, email: destUser.email, role: "TRANSLATOR" } });
    await db.projectMember.create({ data: { projectId: project.id, userId: translator.id, email: translator.email, role: "TRANSLATOR" } });
    const translation = await db.translation.create({ data: { projectId: project.id, originalHash: `hash-${suffix}`,
      originalText: "Hallo", translatedText: "Hello", langFrom: "de", langTo: "en", isManual: true,
      source: "MANUAL", assignedToId: sourceMember.id } });
    await db.apiKey.create({ data: { projectId: project.id, name: "Plugin", key: `hash-${suffix}`, keyPrefix: "dg_test_" } });
    const webhook = await db.webhookEndpoint.create({ data: { projectId: project.id, url: "https://example.invalid/hook",
      secret: "source-secret", eventTypes: ["translation.created"] } });
    await db.webhookDelivery.create({ data: { projectId: project.id, endpointId: webhook.id,
      eventType: "translation.created", payload: { fixture: true } } });
    await db.projectInvitation.create({ data: { projectId: project.id, inviterId: actor.id,
      email: "invite@example.invalid", tokenHash: `invite-${suffix}`, expiresAt: new Date(Date.now() + 86_400_000) } });
    await db.urlSlug.create({ data: { projectId: project.id, originalSlug: "hallo", translatedSlug: "hello", langTo: "en" } });
    await db.translatedUrl.create({ data: { projectId: project.id, urlPath: "/hallo", langTo: "en" } });
    const month = getUsageMonthKey();
    await db.usageRecord.create({ data: { organizationId: source.id, projectId: project.id, month, words: 42 } });
    await db.translationBatchLog.create({ data: { organizationId: source.id, projectId: project.id,
      langFrom: "de", langTo: "en", provider: "mock", totalWords: 42 } });

    await assert.rejects(previewWorkspaceTransfer(sourceUser.id, project.id, destination.id), { code: "NOT_FOUND" });
    await assert.rejects(previewWorkspaceTransfer(destUser.id, project.id, destination.id), { code: "NOT_FOUND" });
    await db.organization.update({ where: { id: destination.id }, data: { plan: "FREE" } });
    const occupyingProject = await db.project.create({ data: { organizationId: destination.id,
      name: "Occupying", domain: `occupying-${suffix}.invalid` } });
    await assert.rejects(previewWorkspaceTransfer(actor.id, project.id, destination.id), { code: "LIMIT" });
    await db.project.delete({ where: { id: occupyingProject.id } });
    await db.organization.update({ where: { id: destination.id }, data: { plan: "STARTER" } });
    let preview = await previewWorkspaceTransfer(actor.id, project.id, destination.id);
    assert.equal(preview.manualTranslations, 1);
    assert.equal(preview.keptProjectMembers, 1);
    assert.equal(preview.removedProjectMembers, 2);
    assert.equal(preview.revokedApiKeys, 1);
    assert.equal(preview.sourceProjectWordsThisMonth, 42);
    await db.organizationMember.update({ where: { userId_organizationId: {
      userId: actor.id, organizationId: destination.id } }, data: { role: "MEMBER" } });
    await assert.rejects(commitWorkspaceTransfer({ actorUserId: actor.id, projectId: project.id,
      destinationId: destination.id, fingerprint: preview.fingerprint, issuedAt: preview.issuedAt,
      confirmationToken: preview.confirmationToken }), { code: "NOT_FOUND" });
    await db.organizationMember.update({ where: { userId_organizationId: {
      userId: actor.id, organizationId: destination.id } }, data: { role: "ADMIN" } });
    await db.translation.update({ where: { id: translation.id }, data: { translatedText: "Hello again" } });
    await assert.rejects(commitWorkspaceTransfer({ actorUserId: actor.id, projectId: project.id,
      destinationId: destination.id, fingerprint: preview.fingerprint, issuedAt: preview.issuedAt,
      confirmationToken: preview.confirmationToken }), { code: "STALE" });
    preview = await previewWorkspaceTransfer(actor.id, project.id, destination.id);
    let releaseWrite!: () => void;
    let reportWritten!: () => void;
    const writeHeld = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const writeStarted = new Promise<void>((resolve) => { reportWritten = resolve; });
    const inFlightWrite = db.$transaction(async (tx) => {
      await incrementUsageRecord({ organizationId: source.id, projectId: project.id, words: 1, month, tx });
      reportWritten();
      await writeHeld;
    });
    await writeStarted;
    const competingTransfer = commitWorkspaceTransfer({ actorUserId: actor.id, projectId: project.id,
      destinationId: destination.id, fingerprint: preview.fingerprint, issuedAt: preview.issuedAt,
      confirmationToken: preview.confirmationToken });
    releaseWrite();
    await inFlightWrite;
    await assert.rejects(competingTransfer, { code: "STALE" });
    preview = await previewWorkspaceTransfer(actor.id, project.id, destination.id);
    const auditCollision = await db.projectTransferAudit.create({ data: {
      projectId: project.id, actorUserId: sourceUser.id, sourceOrganizationId: source.id,
      destinationOrganizationId: destination.id, previewFingerprint: preview.fingerprint,
      projectVersion: new Date(),
    } });
    await assert.rejects(commitWorkspaceTransfer({ actorUserId: actor.id, projectId: project.id,
      destinationId: destination.id, fingerprint: preview.fingerprint, issuedAt: preview.issuedAt,
      confirmationToken: preview.confirmationToken }));
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: project.id } })).organizationId, source.id);
    assert.equal((await db.apiKey.findFirstOrThrow({ where: { projectId: project.id } })).isActive, true);
    assert.equal((await db.webhookEndpoint.findUniqueOrThrow({ where: { id: webhook.id } })).secret, "source-secret");
    await db.projectTransferAudit.delete({ where: { id: auditCollision.id } });
    await assert.rejects(commitWorkspaceTransfer({ actorUserId: actor.id, projectId: project.id,
      destinationId: destination.id, fingerprint: "0".repeat(64), issuedAt: preview.issuedAt,
      confirmationToken: preview.confirmationToken }), { code: "STALE" });
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: project.id } })).organizationId, source.id);

    const commitInput = { actorUserId: actor.id, projectId: project.id,
      destinationId: destination.id, fingerprint: preview.fingerprint, issuedAt: preview.issuedAt,
      confirmationToken: preview.confirmationToken };
    const receipt = await commitWorkspaceTransfer(commitInput);
    assert.deepEqual(await commitWorkspaceTransfer(commitInput), receipt);
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: project.id } })).organizationId, destination.id);
    assert.equal((await db.usageRecord.findFirstOrThrow({ where: { projectId: project.id } })).organizationId, source.id);
    assert.equal((await db.translationBatchLog.findFirstOrThrow({ where: { projectId: project.id } })).organizationId, source.id);
    assert.equal((await db.translation.findUniqueOrThrow({ where: { id: translation.id } })).translatedText, "Hello again");
    assert.equal((await db.translation.findUniqueOrThrow({ where: { id: translation.id } })).assignedToId, null);
    assert.equal(await db.urlSlug.count({ where: { projectId: project.id } }), 1);
    assert.equal(await db.translatedUrl.count({ where: { projectId: project.id } }), 1);
    assert.deepEqual((await db.projectMember.findMany({ where: { projectId: project.id } })).map((row) => row.id), [destMember.id]);
    assert.equal(await db.projectInvitation.count({ where: { projectId: project.id } }), 0);
    assert.equal((await db.apiKey.findFirstOrThrow({ where: { projectId: project.id } })).isActive, false);
    assert.equal((await db.webhookEndpoint.findUniqueOrThrow({ where: { id: webhook.id } })).secret, "");
    assert.equal(await db.webhookDelivery.count({ where: { projectId: project.id } }), 1);
    const movedSettings = await db.projectSettings.findUniqueOrThrow({ where: { projectId: project.id } });
    assert.equal(movedSettings.translationApiKeyEncrypted, null);
    assert.equal(movedSettings.providerReconnectRequired, true);
    const staleSourceWrite = await db.$transaction(async (tx) => {
      if (!(await canManageProjectForWrite(tx, sourceUser.id, project.id))) return false;
      await tx.projectSettings.update({ where: { projectId: project.id }, data: { translationApiKeyEncrypted: "source-reenabled" } });
      return true;
    });
    assert.equal(staleSourceWrite, false);
    assert.equal((await db.projectSettings.findUniqueOrThrow({ where: { projectId: project.id } })).translationApiKeyEncrypted, null);
    assert.equal(await db.projectTransferAudit.count({ where: { projectId: project.id, actorUserId: actor.id } }), 1);
    assert.equal((await db.projectTransferAudit.findUniqueOrThrow({ where: { id: receipt.auditId } })).outcome, "COMMITTED");
    await assert.rejects(incrementUsageRecord({ organizationId: source.id, projectId: project.id, words: 10, month }));
    await assert.rejects(recordTranslationBatch({ organizationId: source.id, projectId: project.id,
      langFrom: "de", langTo: "en", provider: "mock", totalWords: 10, cachedWords: 0,
      manualWords: 0, glossaryWords: 0, translatedWords: 10 }));
    assert.equal((await db.usageRecord.findFirstOrThrow({ where: { projectId: project.id } })).words, 43);

    const platformProject = await db.project.create({ data: { organizationId: source.id,
      name: "Platform fixture", domain: `platform-${suffix}.invalid`, settings: { create: { translationProvider: "openai" } } } });
    const platformPreview = await previewWorkspaceTransfer(actor.id, platformProject.id, destination.id);
    assert.equal(platformPreview.clearedProviderKey, false);
    await commitWorkspaceTransfer({ actorUserId: actor.id, projectId: platformProject.id, destinationId: destination.id,
      fingerprint: platformPreview.fingerprint, issuedAt: platformPreview.issuedAt,
      confirmationToken: platformPreview.confirmationToken });
    assert.equal((await db.projectSettings.findUniqueOrThrow({ where: { projectId: platformProject.id } })).providerReconnectRequired, false);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [source.id, destination.id] } } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    await db.projectTransferAudit.deleteMany({ where: { sourceOrganizationId: source.id } });
    await db.$disconnect();
  }
});
