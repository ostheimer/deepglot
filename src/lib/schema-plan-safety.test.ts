import assert from "node:assert/strict";
import test from "node:test";
import { findDestructiveSchemaStatements } from "./schema-plan-safety";

test("foreign-key delete actions in an additive audit table plan are safe", () => {
  const plan = `CREATE TABLE "AuditEvent" ("id" TEXT NOT NULL);
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;`;
  assert.deepEqual(findDestructiveSchemaStatements(plan), []);
});

test("actual destructive schema statements remain blocked", () => {
  const plan = `DROP TABLE "Translation";
ALTER TABLE "Project" DROP COLUMN "name";
TRUNCATE TABLE "AuditEvent";
DELETE FROM "AuditEvent";
ALTER TABLE "Project" ALTER COLUMN "name" TYPE VARCHAR(20);`;
  assert.equal(findDestructiveSchemaStatements(plan).length, 5);
});
