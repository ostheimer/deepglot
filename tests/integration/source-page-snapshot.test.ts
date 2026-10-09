import assert from "node:assert/strict";
import test from "node:test";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { computeTranslationHash } from "@/lib/translation-hash";
import { recordSourcePageSnapshot, SourceSnapshotError } from "@/lib/source-page-snapshot-workflow";
import { listProjectTranslationWorkflow } from "@/lib/translation-workflow";

test("WordPress source captures classify only every known fresh page, including cache-only digests", {
  skip: resolveDatabaseUrl() ? false : "requires isolated PostgreSQL",
}, async () => {
  const { db } = await import("@/lib/db");
  const suffix = crypto.randomUUID();
  const organization = await db.organization.create({ data: { name: "Source inventory", slug: `source-${suffix}` } });
  try {
    const project = await db.project.create({ data: { organizationId: organization.id,
      name: "Source inventory", domain: `source-${suffix}.test`, originalLang: "de",
      languages: { create: { langCode: "en" } },
    } });
    const { generateApiKey } = await import("@/lib/api-keys");
    const { apiKey } = await generateApiKey({ projectId: project.id, name: "local-observer" });
    const hash = computeTranslationHash("Guten Tag", "de", "en");
    const row = await db.translation.create({ data: { projectId: project.id,
      originalHash: hash, originalText: "Guten Tag", translatedText: "Good day",
      langFrom: "de", langTo: "en", source: "MOCK",
      contexts: { create: [{ urlPath: "/en/a" }, { urlPath: "/en/b" }] },
    } });
    const actor = { canManage: true, projectMemberId: null, langCode: null };
    const list = (sourcePresence?: "present" | "absent_captured_pages" | "unknown") =>
      listProjectTranslationWorkflow({ projectId: project.id, actor,
        filters: { langTo: "en", sourcePresence } });
    assert.equal((await list()).items[0].sourcePresence, "unknown");
    const micros = BigInt(Date.now()) * BigInt(1000);
    const send = (path: string, hashes: string[], capturedMicros: bigint,
      complete = true, dynamicPossible = false) => recordSourcePageSnapshot({
      apiKeyId: apiKey.id, projectId: project.id,
      requestUrl: `https://${project.domain}${path}`, langFrom: "de", langTo: "en",
      originalHashes: hashes, capturedMicros, complete, dynamicPossible,
    });
    await send("/en/a", [hash], micros);
    assert.equal((await list()).items[0].sourcePresence, "present");
    await send("/en/b", [], micros + BigInt(1));
    assert.equal((await list("present")).total, 1);
    assert.equal((await list("absent_captured_pages")).total, 0);
    await send("/en/a", [], micros + BigInt(2));
    assert.equal((await list()).items[0].sourcePresence, "unknown", "Conflicting fresh captures fail closed.");
    await db.sourcePageSnapshot.update({ where: { projectId_urlPath_langTo: {
      projectId: project.id, urlPath: "/en/a", langTo: "en",
    } }, data: { capturedAt: new Date(Date.now() - 16 * 60_000), uncertainUntil: new Date(Date.now() - 1_000) } });
    await send("/en/a", [], micros + BigInt(3));
    assert.equal((await list("absent_captured_pages")).total, 1);
    assert.equal((await send("/en/a", [hash], micros + BigInt(2))).accepted, false,
      "An older HTTP delivery cannot overwrite the latest complete capture.");
    assert.equal((await list()).items[0].sourcePresence, "absent_captured_pages");
    await send("/en/a", [], micros + BigInt(4), false, true);
    assert.equal((await list()).items[0].sourcePresence, "unknown");
    assert.equal((await send("/en/a", [], micros + BigInt(3))).accepted, false,
      "An older complete render must not replace a newer uncertain render.");
    assert.equal((await list()).items[0].sourcePresence, "unknown");
    await db.apiKey.update({ where: { id: apiKey.id }, data: { isActive: false } });
    await assert.rejects(send("/en/a", [], micros + BigInt(5)),
      (error) => error instanceof SourceSnapshotError && error.code === "FORBIDDEN");
    assert.equal(await db.translation.count({ where: { id: row.id } }), 1);
    assert.equal(await db.usageRecord.count({ where: { projectId: project.id } }), 0);
  } finally {
    await db.organization.delete({ where: { id: organization.id } });
    await db.$disconnect();
  }
});
