-- Additive #260 rollout. Apply before deploying the Prisma reader.
-- Existing projects default to disabled example switches; no content rewrite.
ALTER TABLE "ProjectSettings"
  ADD COLUMN IF NOT EXISTS "websiteDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "translationTone" TEXT,
  ADD COLUMN IF NOT EXISTS "translationAudience" TEXT,
  ADD COLUMN IF NOT EXISTS "translationInstructions" TEXT,
  ADD COLUMN IF NOT EXISTS "useGlossaryAsContext" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "useApprovedTranslationsAsContext" BOOLEAN NOT NULL DEFAULT false;
