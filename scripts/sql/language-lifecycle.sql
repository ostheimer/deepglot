-- Additive language controls. Apply to the target database before deploying
-- a Prisma client that reads these columns. Existing targets preserve behavior.
ALTER TABLE "ProjectLanguage"
  ADD COLUMN IF NOT EXISTS "isVisible" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "automaticTranslation" BOOLEAN NOT NULL DEFAULT TRUE;
