-- Additive #257 schema gate. Apply before deploying code that reads contexts.
-- Use a direct connection; first verify in an isolated environment.
BEGIN;
CREATE TABLE IF NOT EXISTS "TranslationContext" (
  "translationId" TEXT NOT NULL,
  "urlPath" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranslationContext_pkey" PRIMARY KEY ("translationId", "urlPath"),
  CONSTRAINT "TranslationContext_translationId_fkey" FOREIGN KEY ("translationId")
    REFERENCES "Translation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TranslationContext_urlPath_idx" ON "TranslationContext"("urlPath");
COMMIT;
