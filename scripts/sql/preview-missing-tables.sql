-- Issue #329: additive repair for the three tables missing from the Vercel
-- Preview database. Verify the target is Neon deepglot/main, not prod, before
-- applying this file over a direct (non-pooled) connection. The definitions
-- and names match `prisma migrate diff --from-empty --to-schema`.
--
-- Re-running this file is safe. The target-schema acceptance check must still
-- verify the resulting columns, indexes, and constraints; IF NOT EXISTS alone
-- does not prove that a pre-existing object has the expected definition.
BEGIN;

CREATE TABLE IF NOT EXISTS "Authenticator" (
  "credentialID" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "credentialPublicKey" TEXT NOT NULL,
  "counter" INTEGER NOT NULL,
  "credentialDeviceType" TEXT NOT NULL,
  "credentialBackedUp" BOOLEAN NOT NULL,
  "transports" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Authenticator_pkey" PRIMARY KEY ("userId", "credentialID")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Authenticator_credentialID_key"
  ON "Authenticator"("credentialID");
CREATE INDEX IF NOT EXISTS "Authenticator_userId_idx"
  ON "Authenticator"("userId");
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"Authenticator"'::regclass
      AND conname = 'Authenticator_userId_fkey'
  ) THEN
    ALTER TABLE "Authenticator" ADD CONSTRAINT "Authenticator_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ActivityDigestDelivery" (
  "id" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "organizationId" TEXT NOT NULL,
  "recipientUserId" TEXT NOT NULL,
  CONSTRAINT "ActivityDigestDelivery_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ActivityDigestDelivery_periodStart_idx"
  ON "ActivityDigestDelivery"("periodStart");
CREATE INDEX IF NOT EXISTS "ActivityDigestDelivery_recipientUserId_idx"
  ON "ActivityDigestDelivery"("recipientUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "ActivityDigestDelivery_organizationId_recipientUserId_perio_key"
  ON "ActivityDigestDelivery"("organizationId", "recipientUserId", "periodStart");
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"ActivityDigestDelivery"'::regclass
      AND conname = 'ActivityDigestDelivery_organizationId_fkey'
  ) THEN
    ALTER TABLE "ActivityDigestDelivery"
      ADD CONSTRAINT "ActivityDigestDelivery_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"ActivityDigestDelivery"'::regclass
      AND conname = 'ActivityDigestDelivery_recipientUserId_fkey'
  ) THEN
    ALTER TABLE "ActivityDigestDelivery"
      ADD CONSTRAINT "ActivityDigestDelivery_recipientUserId_fkey"
      FOREIGN KEY ("recipientUserId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ApiIdempotencyRecord" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "ownerToken" TEXT,
  "responseStatus" INTEGER,
  "responseHeaders" JSONB,
  "responseBody" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApiIdempotencyRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ApiIdempotencyRecord_expiresAt_idx"
  ON "ApiIdempotencyRecord"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ApiIdempotencyRecord_scope_keyHash_key"
  ON "ApiIdempotencyRecord"("scope", "keyHash");

COMMIT;
