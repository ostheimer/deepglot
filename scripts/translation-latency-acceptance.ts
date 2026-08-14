import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

import {
  buildTranslationLatencyCases,
  buildTranslationLatencyRunId,
  evaluateTranslationLatencyPair,
  resolveTranslationLatencyConfig,
  type TranslationLatencyResponse,
} from "@/lib/translation-latency-acceptance";

const API_TIMEOUT_MS = 120_000;

type CliOptions = {
  prodEnvFile: string;
  localEnvFile: string;
  jsonPath: string | null;
  confirmWrite: boolean;
};

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!options.confirmWrite) {
    throw new Error(
      "Refusing to create translation, cache, usage, and batch-log state without --confirm-write.",
    );
  }
  const config = resolveTranslationLatencyConfig({
    production: loadEnvFile(options.prodEnvFile),
    local: loadEnvFile(options.localEnvFile),
    runtime: process.env,
  });
  const { appUrl, apiKey } = config;

  const runId = buildTranslationLatencyRunId();
  const cases = buildTranslationLatencyCases({
    runId,
    requestOrigin: "https://acceptance.deepglot.test",
  });
  const results = [];

  for (const acceptanceCase of cases) {
    const fresh = await requestTranslation({
      appUrl,
      apiKey,
      payload: acceptanceCase.payload,
    });
    const cached = await requestTranslation({
      appUrl,
      apiKey,
      payload: acceptanceCase.payload,
    });
    const evaluation = evaluateTranslationLatencyPair({
      sources: acceptanceCase.sources,
      fresh,
      cached,
    });

    results.push({ segmentCount: acceptanceCase.segmentCount, ...evaluation });
    console.log(
      `${evaluation.status} segments=${acceptanceCase.segmentCount} ${evaluation.detail}`,
    );
  }

  const report = {
    runId,
    appUrl,
    configSource: config.source,
    generatedAt: new Date().toISOString(),
    results,
    summary: {
      passed: results.filter((result) => result.status === "PASS").length,
      failed: results.filter((result) => result.status === "FAIL").length,
    },
  };

  if (options.jsonPath) {
    const target = path.resolve(options.jsonPath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (report.summary.failed > 0) {
    process.exitCode = 1;
  }
}

async function requestTranslation({
  appUrl,
  apiKey,
  payload,
}: {
  appUrl: string;
  apiKey: string;
  payload: unknown;
}): Promise<TranslationLatencyResponse> {
  const startedAt = performance.now();

  try {
    const response = await fetch(new URL("/api/translate", appUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Deepglot translation latency acceptance",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    return {
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      body: await response.json().catch(() => null),
    };
  } catch {
    return {
      status: 0,
      durationMs: Math.round(performance.now() - startedAt),
      body: null,
    };
  }
}

function parseOptions(args: string[]): CliOptions {
  let prodEnvFile = ".env.production.local";
  let localEnvFile = ".env.local";
  let jsonPath: string | null = null;
  let confirmWrite = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const next = args[index + 1];

    if (argument === "--prod-env-file" && next) {
      prodEnvFile = next;
      index += 1;
      continue;
    }

    if (argument === "--local-env-file" && next) {
      localEnvFile = next;
      index += 1;
      continue;
    }

    if (argument === "--json" && next) {
      jsonPath = next;
      index += 1;
      continue;
    }

    if (argument === "--confirm-write") {
      confirmWrite = true;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${argument}`);
  }

  return { prodEnvFile, localEnvFile, jsonPath, confirmWrite };
}

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return {};
  }

  return dotenv.parse(readFileSync(filePath));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
