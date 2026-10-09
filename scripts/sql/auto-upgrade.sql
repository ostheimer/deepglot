-- Issue #269. Additive and repeatable; apply only to the verified target database.
BEGIN;
SET LOCAL search_path = public;

CREATE TABLE IF NOT EXISTS "AutoUpgradePreference" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL UNIQUE REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "maxPlan" "Plan" NOT NULL DEFAULT 'STARTER',
  "maxPriceCents" INTEGER NOT NULL DEFAULT 0,
  "interval" TEXT NOT NULL DEFAULT 'monthly',
  "updatedByUserId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutoUpgradePreference_positive_cap" CHECK ("maxPriceCents" >= 0),
  CONSTRAINT "AutoUpgradePreference_interval" CHECK ("interval" IN ('monthly', 'yearly'))
);

CREATE TABLE IF NOT EXISTS "AutoUpgradeAttempt" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "month" INTEGER NOT NULL,
  "fromPlan" "Plan" NOT NULL,
  "toPlan" "Plan" NOT NULL,
  "fromPriceId" TEXT NOT NULL,
  "toPriceId" TEXT NOT NULL,
  "interval" TEXT NOT NULL,
  "maxPriceCents" INTEGER NOT NULL,
  "usedWords" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CLAIMED',
  "stripeSubscriptionId" TEXT NOT NULL,
  "stripeItemId" TEXT,
  "stripeInvoiceId" TEXT,
  "errorCode" TEXT,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutoUpgradeAttempt_cap" CHECK ("maxPriceCents" >= 0),
  CONSTRAINT "AutoUpgradeAttempt_usage" CHECK ("usedWords" >= 0)
);
ALTER TABLE "AutoUpgradeAttempt" ADD COLUMN IF NOT EXISTS "stripeItemId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "AutoUpgradeAttempt_organizationId_month_fromPlan_key" ON "AutoUpgradeAttempt"("organizationId", "month", "fromPlan");
CREATE INDEX IF NOT EXISTS "AutoUpgradeAttempt_stripeSubscriptionId_status_idx" ON "AutoUpgradeAttempt"("stripeSubscriptionId", "status");

CREATE TABLE IF NOT EXISTS "AutoUpgradeNotification" (
  "id" TEXT PRIMARY KEY,
  "attemptId" TEXT NOT NULL REFERENCES "AutoUpgradeAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "AutoUpgradeNotification_attemptId_userId_kind_key" ON "AutoUpgradeNotification"("attemptId", "userId", "kind");
CREATE INDEX IF NOT EXISTS "AutoUpgradeNotification_userId_createdAt_idx" ON "AutoUpgradeNotification"("userId", "createdAt");
COMMIT;
