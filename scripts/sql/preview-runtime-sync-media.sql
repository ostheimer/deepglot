-- Issue #329: remaining additive Preview drift revealed by full target-schema
-- comparison after restoring the three missing tables. These definitions
-- match the current Prisma schema. Verify the target is Neon deepglot/main,
-- not prod, and use a direct (non-pooled) connection.
--
-- Re-runnable. The target-schema acceptance check must verify definitions;
-- IF NOT EXISTS only prevents duplicate-object failures.
BEGIN;

ALTER TABLE "ProjectSettings"
  ADD COLUMN IF NOT EXISTS "runtimeSyncApiKeyId" TEXT,
  ADD COLUMN IF NOT EXISTS "runtimeSyncConflicts" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "runtimeSyncSiteHost" TEXT;

CREATE TABLE IF NOT EXISTS "ProjectMediaReplacement" (
  "id" TEXT NOT NULL,
  "originalUrl" TEXT NOT NULL,
  "localizedUrl" TEXT NOT NULL,
  "langTo" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "projectId" TEXT NOT NULL,
  CONSTRAINT "ProjectMediaReplacement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectMediaReplacement_projectId_langTo_idx"
  ON "ProjectMediaReplacement"("projectId", "langTo");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectMediaReplacement_projectId_langTo_originalUrl_key"
  ON "ProjectMediaReplacement"("projectId", "langTo", "originalUrl");
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"ProjectMediaReplacement"'::regclass
      AND conname = 'ProjectMediaReplacement_projectId_fkey'
  ) THEN
    ALTER TABLE "ProjectMediaReplacement"
      ADD CONSTRAINT "ProjectMediaReplacement_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
