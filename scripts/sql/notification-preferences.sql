-- Issue #268: additive, repeatable schema change for optional notifications.
-- Apply only after verifying the target host/database/schema and reviewing the
-- diff for that environment. No existing table is altered or data updated.
BEGIN;
SET LOCAL search_path = public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationCategory' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE "NotificationCategory" AS ENUM ('PRODUCT_UPDATE', 'PROJECT_ACTIVITY', 'BILLING_SUMMARY');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationFrequency' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE "NotificationFrequency" AS ENUM ('OFF', 'WEEKLY', 'MONTHLY');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "NotificationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "category" "NotificationCategory" NOT NULL,
  "frequency" "NotificationFrequency" NOT NULL DEFAULT 'OFF',
  "locale" TEXT NOT NULL DEFAULT 'en',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPreference_userId_organizationId_category_key"
  ON "NotificationPreference"("userId", "organizationId", "category");
CREATE INDEX IF NOT EXISTS "NotificationPreference_organizationId_category_frequency_idx"
  ON "NotificationPreference"("organizationId", "category", "frequency");

CREATE TABLE IF NOT EXISTS "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "category" "NotificationCategory" NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationDelivery_userId_organizationId_category_periodS_key"
  ON "NotificationDelivery"("userId", "organizationId", "category", "periodStart");
CREATE INDEX IF NOT EXISTS "NotificationDelivery_periodStart_idx"
  ON "NotificationDelivery"("periodStart");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"NotificationPreference"'::regclass AND conname = 'NotificationPreference_userId_fkey') THEN
    ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"NotificationPreference"'::regclass AND conname = 'NotificationPreference_organizationId_fkey') THEN
    ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"NotificationPreference"'::regclass AND conname = 'NotificationPreference_userId_organizationId_fkey') THEN
    ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_organizationId_fkey"
      FOREIGN KEY ("userId", "organizationId") REFERENCES "OrganizationMember"("userId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"NotificationDelivery"'::regclass AND conname = 'NotificationDelivery_userId_fkey') THEN
    ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"NotificationDelivery"'::regclass AND conname = 'NotificationDelivery_organizationId_fkey') THEN
    ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"NotificationDelivery"'::regclass AND conname = 'NotificationDelivery_userId_organizationId_fkey') THEN
    ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_userId_organizationId_fkey"
      FOREIGN KEY ("userId", "organizationId") REFERENCES "OrganizationMember"("userId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
