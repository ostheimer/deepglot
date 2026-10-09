-- #319 additive schema. Apply before code; safe to run again.
-- Existing tenants have no approvals and therefore cannot dispatch paid AI work
-- until an owner configures both organization and project ceilings.
BEGIN;
CREATE TABLE IF NOT EXISTS "AiBudget" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "projectId" TEXT UNIQUE REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "currency" VARCHAR(3) NOT NULL,
  "capMicros" BIGINT NOT NULL CHECK ("capMicros" >= 0),
  "perCallCapMicros" BIGINT NOT NULL CHECK ("perCallCapMicros" >= 0),
  "warningPercent" INTEGER NOT NULL CHECK ("warningPercent" BETWEEN 1 AND 99),
  "period" TEXT NOT NULL CHECK ("period" = 'MONTHLY_UTC'),
  "approvedByUserId" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "AiBudget_one_org_policy_idx" ON "AiBudget"("organizationId") WHERE "projectId" IS NULL;
CREATE INDEX IF NOT EXISTS "AiBudget_organizationId_idx" ON "AiBudget"("organizationId");
CREATE TABLE IF NOT EXISTS "AiBudgetModel" (
  "id" TEXT PRIMARY KEY,
  "budgetId" TEXT NOT NULL REFERENCES "AiBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "unit" TEXT NOT NULL CHECK ("unit" IN ('TOKEN','CHARACTER','ZERO_COST')),
  "inputMicrosPerMillion" BIGINT NOT NULL CHECK ("inputMicrosPerMillion" >= 0),
  "outputMicrosPerMillion" BIGINT NOT NULL CHECK ("outputMicrosPerMillion" >= 0),
  "maxInputUnits" INTEGER NOT NULL CHECK ("maxInputUnits" > 0),
  "maxOutputUnits" INTEGER NOT NULL CHECK ("maxOutputUnits" >= 0),
  "outputCapVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  "priceExpiresAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiBudgetModel_budgetId_provider_model_key" UNIQUE ("budgetId", "provider", "model")
);
CREATE TABLE IF NOT EXISTS "AiSpendReservation" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "requestKeyHash" TEXT NOT NULL,
  "requestGroupHash" TEXT NOT NULL,
  "dispatchId" TEXT NOT NULL,
  "actorKind" TEXT NOT NULL CHECK ("actorKind" IN ('USER','API_KEY')),
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "periodKey" INTEGER NOT NULL,
  "state" TEXT NOT NULL CHECK ("state" IN ('DISPATCHED','SETTLED','UNKNOWN')),
  "reservedMicros" BIGINT NOT NULL CHECK ("reservedMicros" >= 0),
  "reconciledCeilingMicros" BIGINT CHECK ("reconciledCeilingMicros" >= 0),
  "estimatedInputUnits" INTEGER NOT NULL,
  "maxOutputUnits" INTEGER NOT NULL,
  "orgInputMicrosPerMillion" BIGINT NOT NULL,
  "orgOutputMicrosPerMillion" BIGINT NOT NULL,
  "projectInputMicrosPerMillion" BIGINT NOT NULL,
  "projectOutputMicrosPerMillion" BIGINT NOT NULL,
  "actualInputUnits" INTEGER,
  "actualOutputUnits" INTEGER,
  "unit" TEXT NOT NULL,
  "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  CONSTRAINT "AiSpendReservation_organizationId_requestKeyHash_key" UNIQUE ("organizationId", "requestKeyHash")
);
CREATE INDEX IF NOT EXISTS "AiSpendReservation_organizationId_periodKey_idx" ON "AiSpendReservation"("organizationId", "periodKey");
CREATE INDEX IF NOT EXISTS "AiSpendReservation_projectId_periodKey_idx" ON "AiSpendReservation"("projectId", "periodKey");
CREATE INDEX IF NOT EXISTS "AiSpendReservation_organizationId_requestGroupHash_idx" ON "AiSpendReservation"("organizationId", "requestGroupHash");
CREATE TABLE IF NOT EXISTS "AiBudgetEvent" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "budgetId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "periodKey" INTEGER,
  "threshold" INTEGER,
  "actorId" TEXT,
  "revision" INTEGER,
  "snapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiBudgetEvent_budgetId_kind_periodKey_threshold_key" UNIQUE ("budgetId", "kind", "periodKey", "threshold")
);
CREATE INDEX IF NOT EXISTS "AiBudgetEvent_organizationId_createdAt_idx" ON "AiBudgetEvent"("organizationId", "createdAt");
COMMIT;
