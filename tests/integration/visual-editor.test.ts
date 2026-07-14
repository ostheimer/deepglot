import assert from "node:assert/strict";
import { after, test } from "node:test";

import { resolveDatabaseUrl } from "@/lib/database-url";
import { runVisualEditorPersistenceAcceptance } from "@/lib/visual-editor-acceptance";

const databaseUrl = resolveDatabaseUrl();
const skipWithoutDatabase = databaseUrl
  ? false
  : "requires a prepared PostgreSQL database via DATABASE_URL or DEEPGLOT_DATABASE_URL";

test(
  "visual editor session is language scoped and persists only the authorized project translation",
  { skip: skipWithoutDatabase },
  async () => {
    const result = await runVisualEditorPersistenceAcceptance();

    assert.equal(result.verificationStatus, 200);
    assert.equal(result.verifiedProjectId, result.projectId);
    assert.equal(result.verifiedLanguage, "en");

    assert.equal(result.saveStatus, 200);
    assert.deepEqual(result.persistedTranslation, {
      originalText: "Ein isolierter Editor-Satz.",
      translatedText: "An isolated editor sentence.",
      langFrom: "de",
      langTo: "en",
      isManual: true,
      source: "MANUAL",
    });

    assert.equal(result.crossProjectStatus, 401);
    assert.equal(result.crossLanguageStatus, 403);
    assert.equal(result.deniedTranslationCount, 0);
  }
);

after(async () => {
  if (databaseUrl) {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
  }
});
