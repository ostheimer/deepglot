import test from "node:test";
import assert from "node:assert/strict";

import { resolveDatabaseUrl } from "@/lib/database-url";
import { buildTranslationContext } from "@/lib/translation-context-settings";

test("project context persists independently and approved examples stay project and language scoped", {
  skip: !resolveDatabaseUrl() && "requires isolated PostgreSQL",
}, async () => {
  const { db } = await import("@/lib/db");
  const organization = await db.organization.create({ data: { name: "Context test", slug: crypto.randomUUID() } });
  try {
    const first = await db.project.create({ data: { name: "First", domain: "first.example", organizationId: organization.id } });
    const second = await db.project.create({ data: { name: "Second", domain: "second.example", organizationId: organization.id } });
    await db.projectSettings.create({ data: {
      projectId: first.id,
      websiteDescription: "A clinic",
      translationTone: "warm",
      translationAudience: "patients",
      translationInstructions: "Use plain language",
      useGlossaryAsContext: true,
      useApprovedTranslationsAsContext: true,
    } });
    const stored = await db.projectSettings.findUniqueOrThrow({ where: { projectId: first.id } });
    assert.equal(stored.websiteDescription, "A clinic");
    assert.equal(stored.translationTone, "warm");
    assert.equal(stored.translationAudience, "patients");
    assert.equal(stored.translationInstructions, "Use plain language");
    assert.equal(stored.useGlossaryAsContext, true);
    assert.equal(stored.useApprovedTranslationsAsContext, true);
    assert.equal(await db.projectSettings.findUnique({ where: { projectId: second.id } }), null);

    const make = (projectId: string, langTo: string, status: "MACHINE" | "APPROVED", isManual: boolean) =>
      db.translation.create({ data: {
        projectId, langFrom: "de", langTo,
        originalHash: crypto.randomUUID(), originalText: "Termin buchen",
        translatedText: `${projectId}:${langTo}:${status}`,
        source: "MOCK", workflowStatus: status, isManual,
      } });
    await make(first.id, "en", "APPROVED", false);
    await make(first.id, "en", "MACHINE", true);
    await make(first.id, "en", "MACHINE", false);
    await make(first.id, "fr", "APPROVED", false);
    await make(second.id, "en", "APPROVED", false);
    const examples = await db.translation.findMany({
      where: { projectId: first.id, langFrom: "de", langTo: "en", OR: [{ isManual: true }, { workflowStatus: "APPROVED" }] },
      select: { originalText: true, translatedText: true },
    });
    assert.equal(examples.length, 2);
    assert.ok(examples.every((item) => item.translatedText.startsWith(`${first.id}:en:`)));
    const context = buildTranslationContext({ settings: stored, texts: ["Termin buchen"], examples });
    assert.match(context ?? "", /Website description: A clinic/);
    assert.match(context ?? "", /Example: Termin buchen/);
  } finally {
    await db.organization.delete({ where: { id: organization.id } });
  }
});
