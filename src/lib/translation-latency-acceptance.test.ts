import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  TRANSLATION_LATENCY_SEGMENT_COUNTS,
  buildTranslationLatencyCases,
  buildTranslationLatencyRunId,
  evaluateTranslationLatencyPair,
  resolveTranslationLatencyConfig,
} from "@/lib/translation-latency-acceptance";

test("builds fresh and cached latency cases for 1, 12, 25, and 50 segments", () => {
  const cases = buildTranslationLatencyCases({
    runId: "20260809T191500Z",
    requestOrigin: "https://acceptance.deepglot.test",
  });

  assert.deepEqual(TRANSLATION_LATENCY_SEGMENT_COUNTS, [1, 12, 25, 50]);
  assert.deepEqual(
    cases.map((entry) => entry.sources.length),
    [1, 12, 25, 50]
  );

  for (const entry of cases) {
    assert.equal(entry.payload.words.length, entry.sources.length);
    assert.deepEqual(
      entry.payload.words.map((word) => word.w),
      entry.sources
    );
    assert.match(entry.payload.request_url, /20260809T191500Z/);
    assert.equal(new Set(entry.sources).size, entry.sources.length);
  }
});

test("passes only a complete identical cached translation that is faster", () => {
  const sources = ["Ein frischer deutscher Satz.", "Noch ein deutscher Satz."];
  const translations = ["A fresh German sentence.", "Another German sentence."];

  assert.deepEqual(
    evaluateTranslationLatencyPair({
      sources,
      fresh: {
        status: 200,
        durationMs: 1_250,
        body: { from_words: sources, to_words: translations },
      },
      cached: {
        status: 200,
        durationMs: 120,
        body: { from_words: sources, to_words: translations },
      },
    }),
    {
      status: "PASS",
      detail: "fresh=1250ms; cached=120ms; speedup=10.42x; contract=complete",
      freshDurationMs: 1_250,
      cachedDurationMs: 120,
      speedup: 10.42,
    }
  );
});

test("does not treat HTTP 200 with incomplete, reordered, or empty translations as success", () => {
  const sources = ["Erster Satz.", "Zweiter Satz."];
  const valid = ["First sentence.", "Second sentence."];

  for (const [label, body] of [
    ["missing translation", { from_words: sources, to_words: [valid[0]] }],
    [
      "reordered sources",
      { from_words: [...sources].reverse(), to_words: valid },
    ],
    ["empty translation", { from_words: sources, to_words: [valid[0], ""] }],
    ["identity response", { from_words: sources, to_words: sources }],
  ] as const) {
    const result = evaluateTranslationLatencyPair({
      sources,
      fresh: { status: 200, durationMs: 1_000, body },
      cached: {
        status: 200,
        durationMs: 100,
        body: { from_words: sources, to_words: valid },
      },
    });

    assert.equal(result.status, "FAIL", label);
    assert.match(result.detail, /fresh contract invalid/, label);
  }
});

test("rejects even one source identity in the fully translatable corpus", () => {
  const sources = ["Erster Satz.", "Zweiter Satz."];
  const body = {
    from_words: sources,
    to_words: [sources[0], "Second sentence."],
  };

  const result = evaluateTranslationLatencyPair({
    sources,
    fresh: { status: 200, durationMs: 1_000, body },
    cached: { status: 200, durationMs: 100, body },
  });

  assert.equal(result.status, "FAIL");
  assert.match(result.detail, /source identity/);
});

test("builds millisecond and random-suffix run ids", () => {
  assert.equal(
    buildTranslationLatencyRunId(
      new Date("2026-08-09T19:15:00.123Z"),
      "a1b2c3d4",
    ),
    "20260809T191500123Z-a1b2c3d4",
  );
});

test("selects one complete dotenv provenance and keeps complete process config authoritative", () => {
  const production = {
    DEEPGLOT_LATENCY_ACCEPTANCE_APP_URL: "https://deepglot.ai",
    DEEPGLOT_LATENCY_ACCEPTANCE_API_KEY: "production-key",
  };
  const local = {
    DEEPGLOT_LATENCY_ACCEPTANCE_APP_URL: "https://deepglot.ai",
    DEEPGLOT_LATENCY_ACCEPTANCE_API_KEY: "local-key",
  };

  assert.deepEqual(
    resolveTranslationLatencyConfig({ production, local, runtime: {} }),
    {
      appUrl: "https://deepglot.ai",
      apiKey: "local-key",
      source: "local env file",
    },
  );

  assert.deepEqual(
    resolveTranslationLatencyConfig({
      production,
      local,
      runtime: {
        DEEPGLOT_LATENCY_ACCEPTANCE_APP_URL: "https://deepglot.ai",
        DEEPGLOT_LATENCY_ACCEPTANCE_API_KEY: "runtime-key",
      },
    }),
    {
      appUrl: "https://deepglot.ai",
      apiKey: "runtime-key",
      source: "process environment",
    },
  );
});

test("never mixes acceptance keys and targets across env provenance", () => {
  assert.throws(
    () =>
      resolveTranslationLatencyConfig({
        production: {
          DEEPGLOT_LATENCY_ACCEPTANCE_API_KEY: "production-key",
        },
        local: {
          DEEPGLOT_LATENCY_ACCEPTANCE_APP_URL: "https://local.example",
        },
        runtime: {},
      }),
    /same environment source/,
  );

  assert.throws(
    () =>
      resolveTranslationLatencyConfig({
        production: {},
        local: {
          DEEPGLOT_SAAS_API_KEY: "generic-production-key",
          DEEPGLOT_SAAS_APP_URL: "https://deepglot.ai",
        },
        runtime: {},
      }),
    /dedicated latency acceptance/,
  );
});

test("production acceptance target is pinned to the credential-free canonical origin", () => {
  const resolve = (appUrl: string) =>
    resolveTranslationLatencyConfig({
      production: {},
      local: {
        DEEPGLOT_LATENCY_ACCEPTANCE_APP_URL: appUrl,
        DEEPGLOT_LATENCY_ACCEPTANCE_API_KEY: "acceptance-key",
      },
      runtime: {},
    });

  assert.equal(resolve("https://deepglot.ai").appUrl, "https://deepglot.ai");
  assert.throws(() => resolve("http://deepglot.ai"), /https:\/\/deepglot\.ai/);
  assert.throws(() => resolve("https://evil.example"), /https:\/\/deepglot\.ai/);
  assert.throws(
    () => resolve("https://user:secret@deepglot.ai"),
    /https:\/\/deepglot\.ai/,
  );
  assert.throws(
    () => resolve("https://deepglot.ai/preview"),
    /https:\/\/deepglot\.ai/,
  );
});

test("does not call a repeated response cached when translations differ or it is not faster", () => {
  const sources = ["Ein Satz."];
  const freshBody = { from_words: sources, to_words: ["A sentence."] };

  const changed = evaluateTranslationLatencyPair({
    sources,
    fresh: { status: 200, durationMs: 1_000, body: freshBody },
    cached: {
      status: 200,
      durationMs: 100,
      body: { from_words: sources, to_words: ["One sentence."] },
    },
  });
  assert.equal(changed.status, "FAIL");
  assert.match(changed.detail, /does not match fresh translations/);

  const notFaster = evaluateTranslationLatencyPair({
    sources,
    fresh: { status: 200, durationMs: 100, body: freshBody },
    cached: { status: 200, durationMs: 100, body: freshBody },
  });
  assert.equal(notFaster.status, "FAIL");
  assert.match(notFaster.detail, /not faster/);
});

test("rejects non-200 fresh or cached responses even when the body has arrays", () => {
  const sources = ["Ein Satz."];
  const body = { from_words: sources, to_words: ["A sentence."] };

  for (const [freshStatus, cachedStatus] of [
    [500, 200],
    [200, 429],
  ]) {
    const result = evaluateTranslationLatencyPair({
      sources,
      fresh: { status: freshStatus, durationMs: 1_000, body },
      cached: { status: cachedStatus, durationMs: 100, body },
    });

    assert.equal(result.status, "FAIL");
    assert.match(result.detail, /status/);
  }
});

test("runner loads both dotenv files, requires a dedicated key, and never reports it", () => {
  const script = readFileSync(
    path.join(process.cwd(), "scripts/translation-latency-acceptance.ts"),
    "utf8",
  );
  const contract = readFileSync(
    path.join(process.cwd(), "src/lib/translation-latency-acceptance.ts"),
    "utf8",
  );
  const combined = `${script}\n${contract}`;

  assert.match(script, /--prod-env-file/);
  assert.match(script, /--local-env-file/);
  assert.match(script, /--confirm-write/);
  assert.match(script, /dotenv\.parse\(readFileSync\(filePath\)\)/);
  assert.match(combined, /DEEPGLOT_LATENCY_ACCEPTANCE_API_KEY/);
  assert.doesNotMatch(combined, /MEINHAUSHALT_PROD_DEEPGLOT_API_KEY/);
  assert.doesNotMatch(combined, /DEEPGLOT_SAAS_API_KEY/);
  assert.doesNotMatch(script, /console\.(?:log|error)\([^\n]*apiKey/);
  assert.doesNotMatch(script, /results\.push\([^\n]*body/);
});
