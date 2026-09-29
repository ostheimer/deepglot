-- Additive history for new direct workspace edits. No backfill.
BEGIN;
CREATE TABLE IF NOT EXISTS "TranslationContentRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "translationId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "beforeText" TEXT NOT NULL,
  "afterText" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranslationContentRevision_translationId_fkey" FOREIGN KEY ("translationId")
    REFERENCES "Translation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TranslationContentRevision_actorUserId_fkey" FOREIGN KEY ("actorUserId")
    REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TranslationContentRevision_translationId_createdAt_id_idx"
  ON "TranslationContentRevision"("translationId", "createdAt", "id");
CREATE INDEX IF NOT EXISTS "TranslationContentRevision_actorUserId_idx"
  ON "TranslationContentRevision"("actorUserId");
COMMIT;
