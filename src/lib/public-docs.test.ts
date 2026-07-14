import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DASHBOARD_DEVELOPER_SURFACES,
  PROBLEM_DETAILS_EXAMPLE,
  PROJECT_WEBHOOK_DOC_EVENTS,
  PUBLIC_ENDPOINT_DOCS,
  WORDPRESS_REST_ENDPOINTS,
} from "@/lib/public-docs";
import { PROJECT_WEBHOOK_EVENT_TYPES } from "@/lib/webhooks";

const root = process.cwd();

test("documents every public and plugin SaaS endpoint with a real source file", () => {
  const expected = [
    "/api/translate",
    "/api/public/status",
    "/api/public/languages",
    "/api/public/languages/is-supported?languageFrom=de&languageTo=en",
    "/api/plugin/runtime-config",
    "/api/plugin/settings-sync",
  ];

  assert.deepEqual(PUBLIC_ENDPOINT_DOCS.map((endpoint) => endpoint.path), expected);
  for (const endpoint of PUBLIC_ENDPOINT_DOCS) {
    assert.equal(existsSync(path.join(root, endpoint.sourceFile)), true, endpoint.sourceFile);
    assert.ok(endpoint.summary.en.length > 20);
    assert.ok(endpoint.summary.de.length > 20);
    assert.ok(endpoint.responseExample, `${endpoint.path} lacks a response example`);
  }
});

test("keeps dashboard surfaces and WordPress REST routes represented in public docs", () => {
  for (const surface of DASHBOARD_DEVELOPER_SURFACES) {
    assert.equal(existsSync(path.join(root, surface.sourceFile)), true, surface.sourceFile);
  }
  assert.ok(WORDPRESS_REST_ENDPOINTS.includes("POST /wp-json/deepglot/v1/translate-dynamic"));
  assert.ok(DASHBOARD_DEVELOPER_SURFACES.some((surface) => surface.access === "manage"));
  assert.ok(DASHBOARD_DEVELOPER_SURFACES.some((surface) => surface.access === "member"));
});

test("keeps documented webhook events in lockstep with the delivery contract", () => {
  assert.deepEqual(PROJECT_WEBHOOK_DOC_EVENTS, PROJECT_WEBHOOK_EVENT_TYPES);
});

test("documents Problem Details, quota, rate limits, auth, and idempotency behavior", () => {
  const docsSource = readFileSync(path.join(root, "src/lib/public-docs.ts"), "utf8");
  const problem = JSON.parse(PROBLEM_DETAILS_EXAMPLE);

  assert.equal(problem.status, 400);
  assert.equal(problem.code, "validation_failed");
  for (const required of [
    "Authorization: Bearer",
    "Idempotency-Key",
    "24 hours",
    "402",
    "409",
    "429",
    "Retry-After",
    "sharedAcrossProviders",
  ]) {
    assert.ok(docsSource.includes(required), `Public docs omit: ${required}`);
  }
});
