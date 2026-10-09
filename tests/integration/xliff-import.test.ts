import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDatabaseUrl } from "@/lib/database-url";
import { computeTranslationHash } from "@/lib/translation-hash";
import { serializeXliff } from "@/lib/xliff";

const databaseUrl = resolveDatabaseUrl();
const localDatabase = databaseUrl && ["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname);

test("XLIFF conflict aborts all writes and valid retry commits all segments", { skip: !localDatabase && "requires isolated local PostgreSQL" }, async () => {
  const { db } = await import("@/lib/db");
  const { importTranslationsXliff, ProjectXliffImportError } = await import("@/lib/project-xliff-import");
  const token = Math.random().toString(36).slice(2);
  const organization = await db.organization.create({ data: { name: "XLIFF fixture", slug: `xliff-fixture-${token}` } });
  try {
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
    await assert.rejects(() => importTranslationsXliff({ bytes: bytes(segments), project, access,
      langTo: "en", applyApproved: false, emitRowEvents: false }), (error) => {
      assert.ok(error instanceof ProjectXliffImportError);
      assert.equal(error.status, 409);
      assert.deepEqual(error.issues.map((item) => item.segment), [2]);
      return true;
    });
    assert.equal(await db.translation.count({ where: { projectId: project.id } }), 1);
    assert.equal((await db.translation.findUniqueOrThrow({ where: { projectId_originalHash: { projectId: project.id, originalHash: protectedHash } } })).translatedText, "Protected sentence");

    segments[1].translatedText = "Protected sentence";
    const result = await importTranslationsXliff({ bytes: bytes(segments), project, access,
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
    })), project, access, langTo: "en", applyApproved: false, emitRowEvents: false });
    const machineAfter = await db.translation.findUniqueOrThrow({
      where: { projectId_originalHash: { projectId: project.id, originalHash: machineHash } },
    });
    assert.equal(machineAfter.isManual, false);
    assert.equal(machineAfter.source, "MOCK");

    machineSegment[0].translatedText = "Edited sentence";
    await importTranslationsXliff({ bytes: new TextEncoder().encode(serializeXliff({
      projectId: project.id, langFrom: "de", langTo: "en", segments: machineSegment,
    })), project, access, langTo: "en", applyApproved: false, emitRowEvents: false });
    const editedAfter = await db.translation.findUniqueOrThrow({
      where: { projectId_originalHash: { projectId: project.id, originalHash: machineHash } },
    });
    assert.equal(editedAfter.isManual, true);
    assert.equal(editedAfter.source, "IMPORT");
  } finally {
    await db.organization.delete({ where: { id: organization.id } });
    await db.$disconnect();
  }
});
