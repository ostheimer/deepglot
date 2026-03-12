import test from "node:test";
import assert from "node:assert/strict";

import {
  getTestLoginConfig,
  isTestLoginEnabled,
} from "@/lib/test-login-config";

test("enables test login automatically in development", () => {
  assert.equal(isTestLoginEnabled({ NODE_ENV: "development" }), true);
});

test("enables test login automatically on preview deployments", () => {
  assert.equal(
    isTestLoginEnabled({ NODE_ENV: "production", VERCEL_ENV: "preview" }),
    true
  );
});

test("disables test login automatically on production", () => {
  assert.equal(
    isTestLoginEnabled({ NODE_ENV: "production", VERCEL_ENV: "production" }),
    false
  );
});

test("allows explicit override for test login", () => {
  assert.equal(
    isTestLoginEnabled({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      DEEPGLOT_ENABLE_TEST_LOGIN: "true",
    }),
    true
  );
  assert.equal(
    isTestLoginEnabled({
      NODE_ENV: "development",
      DEEPGLOT_ENABLE_TEST_LOGIN: "false",
    }),
    false
  );
});

test("infers a practical default project domain", () => {
  assert.equal(
    getTestLoginConfig({ NODE_ENV: "development" }).projectDomain,
    "localhost:3000"
  );
  assert.equal(
    getTestLoginConfig({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_URL: "deepglot-preview.vercel.app",
    }).projectDomain,
    "deepglot-preview.vercel.app"
  );
});

test("accepts explicit test login overrides", () => {
  const config = getTestLoginConfig({
    TEST_LOGIN_EMAIL: "qa@example.com",
    TEST_LOGIN_NAME: "QA User",
    TEST_LOGIN_PROJECT_DOMAIN: "preview.example.com",
  });

  assert.equal(config.email, "qa@example.com");
  assert.equal(config.name, "QA User");
  assert.equal(config.projectDomain, "preview.example.com");
});
