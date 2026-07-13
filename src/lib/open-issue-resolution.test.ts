import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const record = readFileSync(
  path.join(process.cwd(), "docs/open-issue-resolution-2026-07-13.md"),
  "utf8"
);

test("records a concrete disposition for every issue open at the start of the run", () => {
  for (const issue of [
    57, 58, 121, 122, 124, 158, 159, 161, 166, 167, 168, 169, 172, 191,
    214,
  ]) {
    assert.match(record, new RegExp(`\\| #${issue} \\|`), `Missing #${issue}`);
  }
});

test("separates shipped work, accepted strategic decisions, and the legal approval gate", () => {
  for (const required of [
    "Implemented and tested",
    "Accepted defer decision",
    "Owner/legal approval required",
    "Demand gate",
    "PostgreSQL",
    "WordPress",
    "Playwright",
  ]) {
    assert.ok(record.includes(required), `Resolution record is missing: ${required}`);
  }
});

test("keeps tracking epics dependent on their child issue evidence", () => {
  assert.match(record, /#124[\s\S]*child issues #57, #58, #121, and #122/);
  assert.match(record, /#159[\s\S]*must not be closed without explicit owner/);
});
