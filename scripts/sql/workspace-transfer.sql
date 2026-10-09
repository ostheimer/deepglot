-- Additive, privacy-minimal receipts for completed workspace transfers (#267).
-- No backfill: past transfers cannot be inferred from current ownership.
BEGIN;
ALTER TABLE "ProjectSettings" ADD COLUMN IF NOT EXISTS "providerReconnectRequired" BOOLEAN NOT NULL DEFAULT false;
-- #263 receipts have no exact usage-record foreign key. Never infer their
-- historical billed owner from the project's *current* workspace. A fresh
-- read-only receipt count is required before rollout; if any legacy receipt
-- exists, investigate its original billing evidence before this script runs.
ALTER TABLE "UrlOperationReceipt" ADD COLUMN IF NOT EXISTS "originatingOrganizationId" TEXT;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "UrlOperationReceipt" WHERE "originatingOrganizationId" IS NULL) THEN
    RAISE EXCEPTION 'Unattributed URL operation receipts require evidence-based reconciliation before workspace transfer rollout';
  END IF;
END $$;
ALTER TABLE "UrlOperationReceipt" ALTER COLUMN "originatingOrganizationId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "UrlOperationReceipt_originatingOrganizationId_createdAt_idx"
  ON "UrlOperationReceipt"("originatingOrganizationId", "createdAt");
CREATE TABLE IF NOT EXISTS "ProjectTransferAudit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "sourceOrganizationId" TEXT NOT NULL,
  "destinationOrganizationId" TEXT NOT NULL,
  "previewFingerprint" TEXT NOT NULL UNIQUE,
  "projectVersion" TIMESTAMP(3) NOT NULL,
  "outcome" TEXT NOT NULL DEFAULT 'COMMITTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ProjectTransferAudit_projectId_createdAt_idx"
  ON "ProjectTransferAudit"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProjectTransferAudit_sourceOrganizationId_createdAt_idx"
  ON "ProjectTransferAudit"("sourceOrganizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProjectTransferAudit_destinationOrganizationId_createdAt_idx"
  ON "ProjectTransferAudit"("destinationOrganizationId", "createdAt");
CREATE TABLE IF NOT EXISTS "WorkspaceAudit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetUserId" TEXT,
  "previousRole" "OrganizationRole",
  "nextRole" "OrganizationRole",
  "previousName" TEXT,
  "nextName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "WorkspaceAudit_workspaceId_createdAt_idx"
  ON "WorkspaceAudit"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "WorkspaceAudit_actorUserId_createdAt_idx"
  ON "WorkspaceAudit"("actorUserId", "createdAt");
CREATE TABLE IF NOT EXISTS "BillingCommand" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorRole" "OrganizationRole" NOT NULL,
  "action" TEXT NOT NULL,
  "targetRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "BillingCommand_workspaceId_createdAt_idx"
  ON "BillingCommand"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "BillingCommand_actorUserId_createdAt_idx"
  ON "BillingCommand"("actorUserId", "createdAt");
COMMIT;
