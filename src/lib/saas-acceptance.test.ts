import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDisposableProjectDomain,
  buildSaasSettingsSyncPayload,
  buildSaasTranslatePayload,
  classifySaasCommandFailure,
  describeSaasBatchLogVerificationError,
  resolveSaasAcceptanceConfig,
} from "@/lib/saas-acceptance";

test("resolves SaaS acceptance config with dashboard and project fallbacks", () => {
  const config = resolveSaasAcceptanceConfig(
    {
      DEEPGLOT_DASHBOARD_URL: "deepglot.test/",
      DEEPGLOT_DASHBOARD_EMAIL: " qa@example.com ",
      DEEPGLOT_DASHBOARD_PASSWORD: " secret ",
      MEINHAUSHALT_PROD_DEEPGLOT_PROJECT_ID: " project_123 ",
      MEINHAUSHALT_PROD_DEEPGLOT_API_KEY: " dg_live_123 ",
    },
    new Date("2026-05-03T10:20:30.000Z")
  );

  assert.deepEqual(config, {
    appUrl: "https://deepglot.test",
    dashboardEmail: "qa@example.com",
    dashboardPassword: "secret",
    projectId: "project_123",
    apiKey: "dg_live_123",
    projectDomain: "acceptance-20260503102030.deepglot.test",
  });
});

test("prefers explicit SaaS acceptance project domain", () => {
  assert.equal(
    resolveSaasAcceptanceConfig({
      DEEPGLOT_SAAS_PROJECT_DOMAIN: "custom.deepglot.test",
    }).projectDomain,
    "custom.deepglot.test"
  );
});

test("builds disposable project domains from timestamps", () => {
  assert.equal(
    buildDisposableProjectDomain(new Date("2026-05-03T01:02:03.000Z")),
    "acceptance-20260503010203.deepglot.test"
  );
});

test("builds translation payloads for the production API contract", () => {
  assert.deepEqual(
    buildSaasTranslatePayload({
      requestUrl: "https://acceptance.deepglot.test/de",
      text: "Hallo Welt",
    }),
    {
      l_from: "de",
      l_to: "en",
      request_url: "https://acceptance.deepglot.test/de",
      title: "Deepglot SaaS acceptance",
      bot: 0,
      words: [{ t: 1, w: "Hallo Welt" }],
    }
  );
});

test("builds conservative runtime settings sync payloads", () => {
  assert.deepEqual(buildSaasSettingsSyncPayload(), {
    routingMode: "PATH_PREFIX",
    siteUrl: "https://www.meinhaushalt.at",
    sourceLanguage: "de",
    targetLanguages: ["en"],
    autoRedirect: false,
    translateEmails: false,
    translateSearch: false,
    translateAmp: false,
    domainMappings: [],
  });
});

test("classifies missing database dependencies as blocked", () => {
  assert.equal(classifySaasCommandFailure("P1001 database not reachable"), "BLOCKED");
  assert.equal(classifySaasCommandFailure("expected status 200"), "FAIL");
});

test("describes batch-log verification database failures as blocked", () => {
  assert.deepEqual(
    describeSaasBatchLogVerificationError(
      "PrismaClientInitializationError: Can't reach database server"
    ),
    {
      status: "BLOCKED",
      detail:
        "Translation response shape passed, but database batch-log verification is blocked by database connectivity.",
    }
  );

  assert.deepEqual(describeSaasBatchLogVerificationError("unexpected parser error"), {
    status: "FAIL",
    detail: "unexpected parser error",
  });
});
