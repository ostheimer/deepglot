-- Additive prerequisite for older preview databases; no translation text changes.
BEGIN;
DO $$ BEGIN
  CREATE TYPE "TranslationWorkflowStatus" AS ENUM ('MACHINE', 'ASSIGNED', 'IN_REVIEW', 'APPROVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "Translation"
  ADD COLUMN IF NOT EXISTS "workflowStatus" "TranslationWorkflowStatus" NOT NULL DEFAULT 'MACHINE',
  ADD COLUMN IF NOT EXISTS "assignedToId" TEXT;
DO $$ BEGIN
  ALTER TABLE "Translation" ADD CONSTRAINT "Translation_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "ProjectMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "Translation_projectId_langTo_workflowStatus_idx"
  ON "Translation"("projectId", "langTo", "workflowStatus");
CREATE INDEX IF NOT EXISTS "Translation_assignedToId_idx" ON "Translation"("assignedToId");
COMMIT;
