-- Additive reported-type provenance. No inferred backfill or content changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS "TranslationTypeObservation" (
  "translationId" TEXT NOT NULL,
  "wordType" INTEGER NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranslationTypeObservation_pkey" PRIMARY KEY ("translationId", "wordType"),
  CONSTRAINT "TranslationTypeObservation_translationId_fkey" FOREIGN KEY ("translationId")
    REFERENCES "Translation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
COMMIT;
