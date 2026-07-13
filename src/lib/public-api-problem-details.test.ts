import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { NextRequest } from "next/server";

const statusQuery = test.mock.fn(async () => {
  throw new Error("database unavailable");
});

(globalThis as unknown as { prisma: unknown }).prisma = {
  $queryRaw: statusQuery,
};

test("public status returns a non-empty Problem Details body on database failure", async () => {
  const { GET } = await import("@/app/api/public/status/route");
  const response = await GET();
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/problem\+json/,
  );
  assert.equal(body.code, "service_unavailable");
  assert.equal(body.status, 503);
  assert.equal(body.instance, "/api/public/status");
  assert.ok(body.detail.length > 0);
  assert.equal(body.error, body.detail);
});

test("language validation reports every missing query field", async () => {
  const { GET } = await import(
    "@/app/api/public/languages/is-supported/route"
  );
  const response = await GET(
    new Request(
      "https://deepglot.test/api/public/languages/is-supported",
    ) as NextRequest,
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, "validation_failed");
  assert.deepEqual(body.errors, {
    languageFrom: ["Required"],
    languageTo: ["Required"],
  });
});

test("plugin and translation auth errors use the shared contract", async () => {
  const [{ GET: getRuntimeConfig }, { POST: translate }, { POST: syncSettings }] =
    await Promise.all([
      import("@/app/api/plugin/runtime-config/route"),
      import("@/app/api/translate/route"),
      import("@/app/api/plugin/settings-sync/route"),
    ]);

  const responses = await Promise.all([
    getRuntimeConfig(
      new Request(
        "https://deepglot.test/api/plugin/runtime-config",
      ) as NextRequest,
    ),
    translate(
      new Request("https://deepglot.test/api/translate", {
        method: "POST",
        body: "{}",
      }) as NextRequest,
    ),
    syncSettings(
      new Request("https://deepglot.test/api/plugin/settings-sync", {
        method: "POST",
        body: "{}",
      }) as NextRequest,
    ),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 401);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^application\/problem\+json/,
    );
    const body = await response.json();
    assert.equal(body.code, "missing_api_key");
    assert.equal(body.status, 401);
    assert.equal(body.error, body.detail);
  }
});

test("all six public and plugin-facing routes wire the shared helper", () => {
  const routes = [
    "src/app/api/translate/route.ts",
    "src/app/api/public/status/route.ts",
    "src/app/api/public/languages/route.ts",
    "src/app/api/public/languages/is-supported/route.ts",
    "src/app/api/plugin/runtime-config/route.ts",
    "src/app/api/plugin/settings-sync/route.ts",
  ];

  for (const route of routes) {
    const source = readFileSync(path.join(process.cwd(), route), "utf8");
    assert.match(
      source,
      /from "@\/lib\/problem-details"/,
      `${route} must use the shared Problem Details helper`,
    );
  }

  const translateSource = readFileSync(
    path.join(process.cwd(), routes[0]),
    "utf8",
  );
  assert.match(translateSource, /code: "quota_exhausted"/);
  assert.match(translateSource, /code: "rate_limit_exceeded"/);
  assert.match(translateSource, /code: "internal_error"/);

  const settingsSource = readFileSync(
    path.join(process.cwd(), routes[5]),
    "utf8",
  );
  assert.match(settingsSource, /code: "domain_mapping_conflict"/);
});
