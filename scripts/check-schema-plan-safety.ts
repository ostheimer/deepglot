import fs from "node:fs";
import { findDestructiveSchemaStatements } from "../src/lib/schema-plan-safety";

const planFile = "schema-plan.sql";
const destructive = findDestructiveSchemaStatements(fs.readFileSync(planFile, "utf8"));
if (destructive.length === 0) {
  console.log(`No destructive statements detected in ${planFile}.`);
} else {
  const apply = process.env.APPLY === "true";
  console.log(`${apply ? "::error::" : "::warning::"}Destructive statement(s) detected in ${planFile}:`);
  for (const statement of destructive) console.log(`  ${statement};`);
  if (apply) {
    console.error("::error::Refusing to apply destructive SQL with apply=true.");
    process.exitCode = 1;
  } else {
    console.log("::warning::apply=false, so this run continues as a plan only; re-check schema-plan.sql before dispatching with apply=true.");
  }
}
