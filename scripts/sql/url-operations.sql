-- Apply before deploying the URL operations reader. Additive and repeatable.
ALTER TABLE "TranslatedUrl" ADD COLUMN IF NOT EXISTS "operationState" TEXT;
ALTER TABLE "TranslatedUrl" ADD COLUMN IF NOT EXISTS "lastResult" TEXT;
ALTER TABLE "TranslatedUrl" ADD COLUMN IF NOT EXISTS "lastHttpStatus" INTEGER;
ALTER TABLE "TranslatedUrl" ADD COLUMN IF NOT EXISTS "origin" TEXT;
ALTER TABLE "TranslatedUrl" ADD COLUMN IF NOT EXISTS "lastOperationAt" TIMESTAMP(3);
ALTER TABLE "TranslatedUrl" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "TranslatedUrl" ADD COLUMN IF NOT EXISTS "operationToken" TEXT;

CREATE TABLE IF NOT EXISTS "UrlCacheInvalidation" (
  "id" BIGSERIAL PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "urlPath" TEXT NOT NULL,
  "cacheKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "UrlCacheInvalidation_projectId_id_idx" ON "UrlCacheInvalidation"("projectId", "id");

CREATE TABLE IF NOT EXISTS "UrlOperationReceipt" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "urlId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "urlPath" TEXT NOT NULL,
  "langTo" TEXT NOT NULL,
  "billedWords" INTEGER NOT NULL,
  "segmentCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "UrlOperationReceipt_projectId_urlId_idx" ON "UrlOperationReceipt"("projectId", "urlId");
