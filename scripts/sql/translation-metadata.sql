-- Additive workspace metadata; leaves translation text and edit tokens untouched.
BEGIN;
CREATE TABLE IF NOT EXISTS "TranslationMetadata" (
  "translationId" TEXT NOT NULL PRIMARY KEY,
  "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "variables" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "note" TEXT NOT NULL DEFAULT '',
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TranslationMetadata_translationId_fkey" FOREIGN KEY ("translationId")
    REFERENCES "Translation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TranslationMetadata_labels_idx" ON "TranslationMetadata" USING GIN ("labels");
COMMIT;
