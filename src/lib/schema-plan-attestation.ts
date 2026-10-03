import { createHash } from "node:crypto";

/** One digest binds the selected main-branch file and exact SQL reviewed in plan. */
export function schemaPlanAttestation(target: string, schema: Buffer, sql: Buffer): string {
  const schemaHash = createHash("sha256").update(schema).digest("hex");
  const sqlHash = createHash("sha256").update(sql).digest("hex");
  return createHash("sha256").update(`${target}\n${schemaHash}\n${sqlHash}\n`).digest("hex");
}

export function verifySchemaPlanAttestation(
  apply: boolean, reviewed: string, target: string, schema: Buffer, sql: Buffer,
): string {
  const actual = schemaPlanAttestation(target, schema, sql);
  if (apply && (!/^[0-9a-f]{64}$/.test(reviewed) || reviewed !== actual)) {
    throw new Error("Apply target or SQL differs from the reviewed plan. Run plan again and use its digest.");
  }
  return actual;
}
