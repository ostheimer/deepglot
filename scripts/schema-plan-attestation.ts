import { readFileSync } from "node:fs";
import { verifySchemaPlanAttestation } from "../src/lib/schema-plan-attestation";

const target = process.env.TARGET_SCHEMA_CHOICE ?? "";
const schemaPath = process.env.TARGET_SCHEMA ?? "";
if (!target || !schemaPath) throw new Error("Schema target is missing.");
const digest = verifySchemaPlanAttestation(
  process.env.APPLY === "true",
  process.env.PLAN_DIGEST ?? "",
  target,
  readFileSync(schemaPath),
  readFileSync("schema-plan.sql"),
);
console.log(`::notice title=Reviewed schema plan digest::${digest}`);
