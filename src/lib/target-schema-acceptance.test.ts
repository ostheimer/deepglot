import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { assessTargetSchemaDiff } from "@/lib/target-schema-acceptance";

test("accepts an empty Prisma target-schema diff", () => {
  assert.deepEqual(assessTargetSchemaDiff("-- This is an empty migration.\n"), {
    ready: true,
    drift: [],
  });
});

test("rejects preview drift across tables, columns, indexes, and constraints", () => {
  const assessment = assessTargetSchemaDiff(`
-- CreateTable
CREATE TABLE "Authenticator" ("credentialID" TEXT NOT NULL);
-- AlterTable
ALTER TABLE "OrganizationMember" ADD COLUMN "activityDigestEnabled" BOOLEAN NOT NULL DEFAULT false;
-- CreateIndex
CREATE UNIQUE INDEX "ActivityDigestDelivery_organizationId_recipientUserId_periodStart_key"
  ON "ActivityDigestDelivery"("organizationId", "recipientUserId", "periodStart");
-- AddForeignKey
ALTER TABLE "ActivityDigestDelivery" ADD CONSTRAINT "ActivityDigestDelivery_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
`);

  assert.equal(assessment.ready, false);
  assert.deepEqual(
    assessment.drift.map((item) => item.kind),
    ["table", "column", "index", "constraint"]
  );
});

test("fails closed on SQL it cannot classify", () => {
  const assessment = assessTargetSchemaDiff(
    'ALTER TABLE "ApiIdempotencyRecord" ALTER COLUMN "status" SET NOT NULL;'
  );

  assert.equal(assessment.ready, false);
  assert.deepEqual(assessment.drift.map((item) => item.kind), ["other"]);
});

test("blocks a Preview deployment when its target database is not configured", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/target-schema-acceptance.ts", "--vercel-build-gate"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VERCEL_ENV: "preview",
        DEEPGLOT_DATABASE_URL: "",
        DATABASE_URL: "",
      },
      encoding: "utf8",
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /DEEPGLOT_DATABASE_URL or DATABASE_URL is required/);
});
