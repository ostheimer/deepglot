import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAcceptanceReport,
  getAcceptanceExitCode,
  summarizeAcceptanceReport,
} from "@/lib/acceptance-report";
import {
  buildBlockedPhase6Check,
  buildEditorBootUrl,
  buildRuntimeConfigUrl,
  buildSubdomainAcceptanceUrl,
  classifyBrowserRedirectProbes,
  classifyPhase6CommandFailure,
  resolvePhase6AcceptanceConfig,
} from "@/lib/phase-6-acceptance";

const ok = { status: 200, location: null };
const toEnglish = {
  status: 302,
  location: "https://www.meinhaushalt.at/en/?deepglot_phase6=1",
};

test("passes the redirect check while the rollout is still guarded (no redirect at all)", () => {
  const result = classifyBrowserRedirectProbes({
    englishFirstVisit: ok,
    sourceLanguageVisit: ok,
    botVisit: ok,
    cookieVisit: ok,
  });

  assert.equal(result.status, "PASS");
  assert.match(result.detail, /disabled/i);
});

test("passes the redirect check when auto-redirect is enabled and every guard holds", () => {
  const result = classifyBrowserRedirectProbes({
    englishFirstVisit: toEnglish,
    sourceLanguageVisit: ok,
    botVisit: ok,
    cookieVisit: ok,
  });

  assert.equal(result.status, "PASS");
  assert.match(result.detail, /enabled/i);
});

test("fails the redirect check when a bot request is redirected", () => {
  const result = classifyBrowserRedirectProbes({
    englishFirstVisit: toEnglish,
    sourceLanguageVisit: ok,
    botVisit: toEnglish,
    cookieVisit: ok,
  });

  assert.equal(result.status, "FAIL");
  assert.match(result.detail, /bot/i);
});

test("fails the redirect check when a source-language visitor is redirected", () => {
  const result = classifyBrowserRedirectProbes({
    englishFirstVisit: toEnglish,
    sourceLanguageVisit: toEnglish,
    botVisit: ok,
    cookieVisit: ok,
  });

  assert.equal(result.status, "FAIL");
  assert.match(result.detail, /source-language/i);
});

test("fails the redirect check when a stored language preference is overridden", () => {
  const result = classifyBrowserRedirectProbes({
    englishFirstVisit: toEnglish,
    sourceLanguageVisit: ok,
    botVisit: ok,
    cookieVisit: toEnglish,
  });

  assert.equal(result.status, "FAIL");
  assert.match(result.detail, /cookie/i);
});

test("fails the redirect check when an enabled redirect points somewhere other than a localized path", () => {
  const result = classifyBrowserRedirectProbes({
    englishFirstVisit: { status: 302, location: "https://example.com/evil" },
    sourceLanguageVisit: ok,
    botVisit: ok,
    cookieVisit: ok,
  });

  assert.equal(result.status, "FAIL");
  assert.match(result.detail, /target/i);
});

test("resolves Phase 6 acceptance defaults and production fallbacks", () => {
  assert.deepEqual(
    resolvePhase6AcceptanceConfig({
      MEINHAUSHALT_PROD_DEEPGLOT_PROJECT_ID: " project_123 ",
      MEINHAUSHALT_PROD_DEEPGLOT_API_KEY: " dg_live_123 ",
      DEEPGLOT_EDITOR_SECRET: " secret ",
    }),
    {
      appUrl: "https://deepglot.ai",
      wordpressUrl: "https://www.meinhaushalt.at",
      projectId: "project_123",
      apiKey: "dg_live_123",
      editorSecret: "secret",
      subdomainHost: null,
    }
  );
});

test("normalizes explicit Phase 6 app and WordPress URLs", () => {
  const config = resolvePhase6AcceptanceConfig({
    DEEPGLOT_PHASE6_APP_URL: "deepglot.test/",
    DEEPGLOT_PHASE6_WORDPRESS_URL: "https://example.test/",
  });

  assert.equal(config.appUrl, "https://deepglot.test");
  assert.equal(config.wordpressUrl, "https://example.test");
});

test("preserves documented defaults when Phase 6 URLs are blank", () => {
  const config = resolvePhase6AcceptanceConfig({
    DEEPGLOT_PHASE6_APP_URL: "",
    DEEPGLOT_PHASE6_WORDPRESS_URL: "",
  });

  assert.equal(config.appUrl, "https://deepglot.ai");
  assert.equal(config.wordpressUrl, "https://www.meinhaushalt.at");
});

test("uses the runtime editor secret fallback chain for Phase 6 acceptance", () => {
  assert.equal(
    resolvePhase6AcceptanceConfig({
      DEEPGLOT_EDITOR_SECRET: " ",
      AUTH_SECRET: " auth-secret ",
    }).editorSecret,
    "auth-secret"
  );

  assert.equal(
    resolvePhase6AcceptanceConfig({
      DEEPGLOT_EDITOR_SECRET: "",
      NEXTAUTH_SECRET: " next-auth-secret ",
    }).editorSecret,
    "next-auth-secret"
  );
});

test("builds runtime-config URLs without requiring callers to expose secrets in details", () => {
  const config = resolvePhase6AcceptanceConfig({
    DEEPGLOT_PHASE6_APP_URL: "https://app.example",
    DEEPGLOT_PHASE6_API_KEY: "dg_live_secret",
  });

  const url = buildRuntimeConfigUrl(config);

  assert.equal(
    url,
    "https://app.example/api/plugin/runtime-config?api_key=dg_live_secret"
  );
});

test("returns null runtime-config URL when the API key is missing", () => {
  const config = resolvePhase6AcceptanceConfig({});

  assert.equal(buildRuntimeConfigUrl(config), null);
});

test("builds short-lived visual editor boot URLs", () => {
  const config = resolvePhase6AcceptanceConfig({
    DEEPGLOT_PHASE6_WORDPRESS_URL: "https://www.example.test",
    DEEPGLOT_PHASE6_PROJECT_ID: "project_123",
    DEEPGLOT_EDITOR_SECRET: "editor_secret",
  });

  const url = buildEditorBootUrl({
    config,
    path: "/en/test/",
    ttlSeconds: 120,
  });

  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://www.example.test");
  assert.equal(parsed.pathname, "/en/test/");
  assert.equal(parsed.searchParams.get("deepglot_editor"), "1");
  assert.equal(parsed.searchParams.get("deepglot_editor_project"), "project_123");
  assert.ok(parsed.searchParams.get("deepglot_editor_token"));
  assert.ok(parsed.searchParams.get("deepglot_phase6"));
});

test("does not build editor boot URLs without project or editor secret", () => {
  const config = resolvePhase6AcceptanceConfig({
    DEEPGLOT_PHASE6_PROJECT_ID: "project_123",
  });

  assert.equal(buildEditorBootUrl({ config }), null);
});

test("builds subdomain acceptance URLs from host-only or full URL values", () => {
  assert.equal(
    buildSubdomainAcceptanceUrl("en.example.test", 123),
    "https://en.example.test/?deepglot_phase6=123"
  );
  assert.equal(
    buildSubdomainAcceptanceUrl("https://en.example.test/path", 123),
    "https://en.example.test/?deepglot_phase6=123"
  );
});

test("returns null for invalid subdomain acceptance hosts", () => {
  assert.equal(buildSubdomainAcceptanceUrl("", 123), null);
  assert.equal(buildSubdomainAcceptanceUrl("https://", 123), null);
});

test("classifies missing runtime dependencies as blocked, not failed", () => {
  assert.equal(
    classifyPhase6CommandFailure("PrismaClientInitializationError: P1001"),
    "BLOCKED"
  );
  assert.equal(classifyPhase6CommandFailure("php: command not found"), "BLOCKED");
  assert.equal(classifyPhase6CommandFailure("expected value to be visible"), "FAIL");
});

test("builds blocked checks for missing Phase 6 runtime values", () => {
  assert.deepEqual(
    buildBlockedPhase6Check({
      name: "Visual editor boot",
      missing: ["DEEPGLOT_EDITOR_SECRET"],
    }),
    {
      name: "Visual editor boot",
      status: "BLOCKED",
      detail: "Missing required runtime configuration: DEEPGLOT_EDITOR_SECRET.",
    }
  );
});

test("keeps Phase 6 blocked report summaries non-fatal outside strict mode", () => {
  const report = buildAcceptanceReport({
    name: "phase 6",
    checks: [
      { name: "wordpress", status: "PASS", detail: "ok" },
      { name: "subdomain", status: "BLOCKED", detail: "missing mapped host" },
    ],
    now: new Date("2026-05-02T00:00:00.000Z"),
  });

  assert.deepEqual(summarizeAcceptanceReport(report), {
    total: 2,
    passed: 1,
    failed: 0,
    blocked: 1,
    skipped: 0,
  });
  assert.equal(getAcceptanceExitCode(report), 0);
  assert.equal(getAcceptanceExitCode(report, true), 1);
});
