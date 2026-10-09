import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDatabaseUrl } from "@/lib/database-url";
import { computeTranslationHash } from "@/lib/translation-hash";
import { encodeWordpressCacheInvalidationKey } from "@/lib/url-operations";
import { serializeXliff } from "@/lib/xliff";

const databaseUrl = resolveDatabaseUrl();
const localDatabase = databaseUrl && ["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname);

test("XLIFF conflict aborts all writes and valid retry commits all segments", { skip: !localDatabase && "requires isolated local PostgreSQL" }, async () => {
  const { db } = await import("@/lib/db");
  const { importTranslationsXliff, ProjectXliffImportError } = await import("@/lib/project-xliff-import");
  const token = Math.random().toString(36).slice(2);
  const user = await db.user.create({ data: { email: `xliff-${token}@example.invalid` } });
  const organization = await db.organization.create({ data: { name: "XLIFF fixture", slug: `xliff-fixture-${token}` } });
  try {
    await db.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
    const project = await db.project.create({ data: {
      name: "XLIFF fixture", domain: `${token}.example.invalid`, originalLang: "de", organizationId: organization.id,
      languages: { create: [{ langCode: "en" }] },
    } });
    const access = { organizationRole: "OWNER" as const, projectRole: null, langCode: null };
    const protectedSource = "Geschützter Satz";
    const protectedHash = computeTranslationHash(protectedSource, "de", "en");
    await db.translation.create({ data: {
      projectId: project.id, originalHash: protectedHash, originalText: protectedSource,
      translatedText: "Protected sentence", langFrom: "de", langTo: "en", isManual: true, source: "MANUAL",
    } });
    const segments = [
      { originalText: "Neuer Satz {name}", translatedText: "New sentence {name}", workflowStatus: "MACHINE" },
      { originalText: protectedSource, translatedText: "Overwritten", workflowStatus: "MACHINE" },
    ];
    const bytes = (items: typeof segments) => new TextEncoder().encode(serializeXliff({
      projectId: project.id, langFrom: "de", langTo: "en", segments: items,
    }));
    await assert.rejects(() => importTranslationsXliff({ bytes: bytes(segments), project, access, userId: user.id,
      langTo: "en", applyApproved: false, emitRowEvents: false }), (error) => {
      assert.ok(error instanceof ProjectXliffImportError);
      assert.equal(error.status, 409);
      assert.deepEqual(error.issues.map((item) => item.segment), [2]);
      return true;
    });
    assert.equal(await db.translation.count({ where: { projectId: project.id } }), 1);
    assert.equal((await db.translation.findUniqueOrThrow({ where: { projectId_originalHash: { projectId: project.id, originalHash: protectedHash } } })).translatedText, "Protected sentence");

    segments[1].translatedText = "Protected sentence";
    const result = await importTranslationsXliff({ bytes: bytes(segments), project, access, userId: user.id,
      langTo: "en", applyApproved: false, emitRowEvents: false });
    assert.equal(result.importedRows, 2);
    assert.equal(await db.translation.count({ where: { projectId: project.id } }), 2);
    const protectedAfter = await db.translation.findUniqueOrThrow({
      where: { projectId_originalHash: { projectId: project.id, originalHash: protectedHash } },
    });
    assert.equal(protectedAfter.translatedText, "Protected sentence");
    assert.equal(protectedAfter.isManual, true);
    assert.equal(protectedAfter.source, "MANUAL");

    const machineText = "Automatischer Satz";
    const machineHash = computeTranslationHash(machineText, "de", "en");
    await db.translation.create({ data: {
      projectId: project.id, originalHash: machineHash, originalText: machineText,
      translatedText: "Automatic sentence", langFrom: "de", langTo: "en", isManual: false, source: "MOCK",
    } });
    const machineSegment = [{ originalText: machineText, translatedText: "Automatic sentence", workflowStatus: "MACHINE", isManual: false }];
    await importTranslationsXliff({ bytes: new TextEncoder().encode(serializeXliff({
      projectId: project.id, langFrom: "de", langTo: "en", segments: machineSegment,
    })), project, access, userId: user.id, langTo: "en", applyApproved: false, emitRowEvents: false });
    const machineAfter = await db.translation.findUniqueOrThrow({
      where: { projectId_originalHash: { projectId: project.id, originalHash: machineHash } },
    });
    assert.equal(machineAfter.isManual, false);
    assert.equal(machineAfter.source, "MOCK");
    const invalidationCount = await db.urlCacheInvalidation.count({ where: { projectId: project.id } });
    await importTranslationsXliff({ bytes: new TextEncoder().encode(serializeXliff({
      projectId: project.id, langFrom: "de", langTo: "en", segments: machineSegment,
    })), project, access, userId: user.id, langTo: "en", applyApproved: false, emitRowEvents: false });
    const machineUnchanged = await db.translation.findUniqueOrThrow({
      where: { projectId_originalHash: { projectId: project.id, originalHash: machineHash } },
    });
    assert.equal(machineUnchanged.updatedAt.getTime(), machineAfter.updatedAt.getTime());
    assert.equal(await db.urlCacheInvalidation.count({ where: { projectId: project.id } }), invalidationCount);

    await db.translationContext.createMany({ data: Array.from({ length: 300 }, (_, index) => ({
      translationId: machineAfter.id, urlPath: `/page-${String(index).padStart(3, "0")}`,
    })) });
    machineSegment[0].translatedText = "Edited sentence";
    await importTranslationsXliff({ bytes: new TextEncoder().encode(serializeXliff({
      projectId: project.id, langFrom: "de", langTo: "en", segments: machineSegment,
    })), project, access, userId: user.id, langTo: "en", applyApproved: false, emitRowEvents: false });
    const editedAfter = await db.translation.findUniqueOrThrow({
      where: { projectId_originalHash: { projectId: project.id, originalHash: machineHash } },
    });
    assert.equal(editedAfter.isManual, true);
    assert.equal(editedAfter.source, "IMPORT");
    assert.equal(await db.urlCacheInvalidation.count({ where: { projectId: project.id } }), invalidationCount + 1);
    const latestInvalidation = await db.urlCacheInvalidation.findFirstOrThrow({ where: { projectId: project.id }, orderBy: { id: "desc" } });
    assert.equal(latestInvalidation.urlPath, "/page-000");

    await db.webhookEndpoint.create({ data: { projectId: project.id, url: "https://example.invalid/hook",
      secret: "synthetic-secret", eventTypes: ["translation.created"], enabled: true } });
    await db.webhookEndpoint.create({ data: { projectId: project.id, url: "https://example.invalid/second-hook",
      secret: "synthetic-secret", eventTypes: ["translation.created"], enabled: true } });
    const bulkSegments = Array.from({ length: 205 }, (_, index) => ({
      originalText: `Neuer Satz ${index}`, translatedText: `New sentence ${index}`, workflowStatus: "MACHINE",
    }));
    const bulkResult = await importTranslationsXliff({ bytes: bytes(bulkSegments), project, access, userId: user.id,
      langTo: "en", applyApproved: false, emitRowEvents: true });
    assert.equal(bulkResult.importedRows, 205);
    assert.equal(await db.translation.count({ where: { projectId: project.id } }), 208);
    assert.equal(await db.webhookDelivery.count({ where: { projectId: project.id, eventType: "translation.created" } }), 410);

    const legacySource = "Alter Satz mit großgeschriebenen Sprachcodes";
    const legacyHash = computeTranslationHash(legacySource, "dE", "eN");
    await db.translation.create({ data: { projectId: project.id, originalHash: legacyHash, originalText: legacySource,
      translatedText: "Old sentence", langFrom: "dE", langTo: "eN", isManual: false, source: "MOCK" } });
    await importTranslationsXliff({ bytes: new TextEncoder().encode(serializeXliff({
      projectId: project.id, langFrom: "de", langTo: "en",
      segments: [{ originalHash: legacyHash, originalText: legacySource, translatedText: "Updated sentence", workflowStatus: "MACHINE" }],
    })), project, access, userId: user.id, langTo: "en", applyApproved: false, emitRowEvents: false });
    const legacyAfter = await db.translation.findUniqueOrThrow({ where: { projectId_originalHash: { projectId: project.id, originalHash: legacyHash } } });
    assert.equal(legacyAfter.translatedText, "Updated sentence");
    assert.equal(legacyAfter.langFrom, "dE");
    assert.equal(legacyAfter.langTo, "eN");
    const legacyInvalidation = await db.urlCacheInvalidation.findFirstOrThrow({ where: { projectId: project.id }, orderBy: { id: "desc" } });
    assert.equal(legacyInvalidation.cacheKey, encodeWordpressCacheInvalidationKey("dE", "eN", legacySource));

    await db.organizationMember.delete({ where: { userId_organizationId: { userId: user.id, organizationId: organization.id } } });
    await assert.rejects(() => importTranslationsXliff({ bytes: bytes(segments), project, access, userId: user.id,
      langTo: "en", applyApproved: false, emitRowEvents: false }), (error) => {
      assert.ok(error instanceof ProjectXliffImportError);
      assert.equal(error.status, 403);
      return true;
    });
  } finally {
    await db.organization.delete({ where: { id: organization.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
