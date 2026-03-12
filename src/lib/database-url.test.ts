import assert from "node:assert/strict";
import test from "node:test";

import { isNeonDatabaseUrl } from "@/lib/database-url";

test("detects Neon database hosts", () => {
  assert.equal(
    isNeonDatabaseUrl(
      "postgresql://user:password@ep-calm-river-a1b2c3.eu-central-1.aws.neon.tech/deepglot?sslmode=require"
    ),
    true
  );
});

test("treats localhost PostgreSQL as a non-Neon connection", () => {
  assert.equal(
    isNeonDatabaseUrl(
      "postgresql://postgres:postgres@localhost:5432/deepglot?sslmode=disable"
    ),
    false
  );
});

test("treats loopback PostgreSQL as a non-Neon connection", () => {
  assert.equal(
    isNeonDatabaseUrl(
      "postgresql://postgres:postgres@127.0.0.1:5432/deepglot?sslmode=disable"
    ),
    false
  );
});

test("falls back to string matching for unusual connection strings", () => {
  assert.equal(
    isNeonDatabaseUrl("postgresql://user:password@ep-example.neon.tech/deepglot"),
    true
  );
});
