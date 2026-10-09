-- Additive, digest-only #257 source-page observations. No translation backfill.
-- Apply to an isolated clone before any shared database or runtime release.
BEGIN;
CREATE TABLE IF NOT EXISTS "SourcePageSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "urlPath" TEXT NOT NULL,
  "langFrom" TEXT NOT NULL,
  "langTo" TEXT NOT NULL,
  "originalHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "complete" BOOLEAN NOT NULL,
  "dynamicPossible" BOOLEAN NOT NULL,
  "provenance" TEXT NOT NULL,
  "contentDigest" TEXT NOT NULL,
  "clientCapturedMicros" BIGINT NOT NULL,
  "uncertainUntil" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourcePageSnapshot_projectId_fkey" FOREIGN KEY ("projectId")
    REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SourcePageSnapshot_complete_static_check" CHECK (NOT "complete" OR NOT "dynamicPossible")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SourcePageSnapshot_projectId_urlPath_langTo_key"
  ON "SourcePageSnapshot"("projectId", "urlPath", "langTo");
CREATE INDEX IF NOT EXISTS "SourcePageSnapshot_projectId_langTo_capturedAt_idx"
  ON "SourcePageSnapshot"("projectId", "langTo", "capturedAt");
COMMIT;
