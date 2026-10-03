import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { schemaPlanAttestation, verifySchemaPlanAttestation } from "./schema-plan-attestation";

test("schema apply is bound to the reviewed target, schema and SQL plan", () => {
  const schema = Buffer.from("model ProjectSettings { switcherOwner String }");
  const sql = Buffer.from("ALTER TABLE ProjectSettings ADD COLUMN switcherOwner TEXT;");
  const reviewed = schemaPlanAttestation("predeploy-switcher-262", schema, sql);
  assert.match(reviewed, /^[0-9a-f]{64}$/);
  assert.equal(verifySchemaPlanAttestation(true, reviewed, "predeploy-switcher-262", schema, sql), reviewed);
  assert.throws(() => verifySchemaPlanAttestation(true, "", "predeploy-switcher-262", schema, sql));
  assert.throws(() => verifySchemaPlanAttestation(true, reviewed, "current", schema, sql));
  assert.throws(() => verifySchemaPlanAttestation(true, reviewed, "predeploy-switcher-262", Buffer.from("other schema"), sql));
  assert.throws(() => verifySchemaPlanAttestation(true, reviewed, "predeploy-switcher-262", schema, Buffer.from("other SQL")));
  assert.equal(verifySchemaPlanAttestation(false, "", "predeploy-switcher-262", schema, sql), reviewed);
});

test("documented production apply dispatch carries the reviewed plan digest", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /-f apply=true -f schema_sha=<printed commit> -f target_schema=<same target> -f plan_digest=<printed digest>/);
});
