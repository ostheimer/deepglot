import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

import {
  buildAcceptanceReport,
  getAcceptanceExitCode,
  renderAcceptanceJson,
  renderAcceptanceJunit,
  renderAcceptanceText,
  type AcceptanceCheck,
} from "@/lib/acceptance-report";
import {
  buildBlockedPhase6Check,
  buildEditorBootUrl,
  buildRuntimeConfigUrl,
  buildSubdomainAcceptanceUrl,
  classifyPhase6CommandFailure,
  resolvePhase6AcceptanceConfig,
  type Phase6AcceptanceConfig,
} from "@/lib/phase-6-acceptance";
import { redactAcceptanceOutput } from "@/lib/production-acceptance";

type Options = {
  prodEnvFile: string;
  localEnvFile: string;
  jsonFile: string | null;
  junitFile: string | null;
  strict: boolean;
  skipLive: boolean;
  skipE2e: boolean;
};

type LoadedEnvFile = {
  path: string;
  exists: boolean;
  values: Record<string, string>;
};

type RuntimeConfigResponse = {
  exclusions?: {
    urls?: unknown;
    regexes?: unknown;
    selectors?: unknown;
  };
  syncedAt?: unknown;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    prodEnvFile: ".env.production.local",
    localEnvFile: ".env.local",
    jsonFile: null,
    junitFile: null,
    strict: false,
    skipLive: false,
    skipE2e: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--prod-env-file" && next) {
      options.prodEnvFile = next;
      index += 1;
    } else if (arg === "--local-env-file" && next) {
      options.localEnvFile = next;
      index += 1;
    } else if (arg === "--json" && next) {
      options.jsonFile = next;
      index += 1;
    } else if (arg === "--junit" && next) {
      options.junitFile = next;
      index += 1;
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--skip-live") {
      options.skipLive = true;
    } else if (arg === "--skip-e2e") {
      options.skipE2e = true;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: npm run acceptance:phase6 -- [options]

Options:
  --prod-env-file <path>       Production dotenv file. Default: .env.production.local
  --local-env-file <path>      Local/test dotenv file. Default: .env.local
  --json <path>                Write a JSON report.
  --junit <path>               Write a JUnit XML report.
  --strict                     Exit non-zero for blocked or skipped checks.
  --skip-live                  Skip production WordPress/backend live checks.
  --skip-e2e                   Skip Playwright dashboard checks.

Default mode is read-only. It does not save visual-editor edits, change
WordPress settings, create DNS records, or mutate Stripe billing resources.`);
}

function loadEnvFile(filePath: string): LoadedEnvFile {
  if (!existsSync(filePath)) {
    return { path: filePath, exists: false, values: {} };
  }

  return {
    path: filePath,
    exists: true,
    values: dotenv.parse(readFileSync(filePath)),
  };
}

function writeReportFile(filePath: string, contents: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function mergeAcceptanceEnv(prodEnvFile: LoadedEnvFile, localEnvFile: LoadedEnvFile) {
  return {
    ...prodEnvFile.values,
    ...localEnvFile.values,
    ...process.env,
  };
}

function localCommandEnv(localEnvFile: LoadedEnvFile): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...localEnvFile.values,
    DEEPGLOT_ENABLE_TEST_LOGIN:
      process.env.DEEPGLOT_ENABLE_TEST_LOGIN ??
      localEnvFile.values.DEEPGLOT_ENABLE_TEST_LOGIN ??
      "true",
    TRANSLATION_PROVIDER:
      process.env.TRANSLATION_PROVIDER ??
      localEnvFile.values.TRANSLATION_PROVIDER ??
      "mock",
  };
}

function runNpmCheck({
  name,
  args,
  env,
}: {
  name: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}): AcceptanceCheck {
  const startedAt = Date.now();
  const result = spawnSync("npm", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
  });
  const durationMs = Date.now() - startedAt;
  const output = summarizeChildOutput(result.stdout, result.stderr);

  if (result.status === 0) {
    return {
      name,
      status: "PASS",
      detail: output || `npm ${args.join(" ")} passed.`,
      durationMs,
    };
  }

  return {
    name,
    status: classifyPhase6CommandFailure(output),
    detail: output || `npm ${args.join(" ")} exited with ${result.status ?? "unknown status"}.`,
    durationMs,
  };
}

function summarizeChildOutput(stdout: string | null, stderr: string | null) {
  const lines = `${stdout ?? ""}\n${stderr ?? ""}`
    .split(/\r?\n/)
    .map((line) => redactPhase6Output(stripAnsi(line).trim()))
    .filter(Boolean);
  const summaryLines = lines.filter((line) => {
    return /\b(?:passed|failed|skipped)\b/i.test(line) && !/warning/i.test(line);
  });

  return (summaryLines.length > 0 ? summaryLines : lines).slice(-8).join(" | ");
}

function redactPhase6Output(value: string) {
  return redactAcceptanceOutput(value)
    .replace(/dg_(?:live|test)_[A-Za-z0-9._~+/=-]+/g, "dg_[redacted]")
    .replace(/api_key=([^&\s]+)/gi, "api_key=[redacted]")
    .replace(/token=([^&\s]+)/gi, "token=[redacted]");
}

function stripAnsi(value: string) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

async function checkWordPressTranslatedPath(
  config: Phase6AcceptanceConfig
): Promise<AcceptanceCheck> {
  const startedAt = Date.now();
  const url = new URL("/en/", config.wordpressUrl);
  url.searchParams.set("deepglot_phase6", String(Date.now()));

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Deepglot Phase 6 acceptance" },
      signal: AbortSignal.timeout(20_000),
    });
    const html = await response.text();
    const visibleText = extractVisibleText(html);
    const hasEnglishSignals = /Jump to content|Homepage|Household|Categories/i.test(
      visibleText
    );
    const hasRawLanguageMarker = html.includes("[en]");

    return {
      name: "WordPress translated /en/ output",
      status: response.ok && hasEnglishSignals && !hasRawLanguageMarker ? "PASS" : "FAIL",
      detail: `${response.status}; englishSignals=${hasEnglishSignals}; rawMarker=${hasRawLanguageMarker}.`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return failureCheck("WordPress translated /en/ output", error, startedAt);
  }
}

async function checkRuntimeConfig(config: Phase6AcceptanceConfig): Promise<AcceptanceCheck> {
  if (!config.apiKey) {
    return buildBlockedPhase6Check({
      name: "Plugin runtime-config API",
      missing: [
        "DEEPGLOT_PHASE6_API_KEY or MEINHAUSHALT_PROD_DEEPGLOT_API_KEY",
      ],
    });
  }

  const url = buildRuntimeConfigUrl(config);
  if (!url) {
    return buildBlockedPhase6Check({
      name: "Plugin runtime-config API",
      missing: ["DEEPGLOT_PHASE6_API_KEY"],
    });
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Deepglot Phase 6 acceptance" },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json().catch(() => null)) as RuntimeConfigResponse | null;
    const validShape =
      !!body &&
      Array.isArray(body.exclusions?.urls) &&
      Array.isArray(body.exclusions?.regexes) &&
      Array.isArray(body.exclusions?.selectors) &&
      (typeof body.syncedAt === "string" || body.syncedAt === null);

    return {
      name: "Plugin runtime-config API",
      status: response.ok && validShape ? "PASS" : "FAIL",
      detail: `${response.status}; exclusionsShape=${validShape}.`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return failureCheck("Plugin runtime-config API", error, startedAt);
  }
}

async function checkVisualEditorBoot(config: Phase6AcceptanceConfig): Promise<AcceptanceCheck> {
  const missing = [];
  if (!config.projectId) {
    missing.push(
      "DEEPGLOT_PHASE6_PROJECT_ID or MEINHAUSHALT_PROD_DEEPGLOT_PROJECT_ID"
    );
  }
  if (!config.editorSecret) {
    missing.push("DEEPGLOT_EDITOR_SECRET");
  }
  if (missing.length > 0) {
    return buildBlockedPhase6Check({
      name: "Visual editor WordPress boot",
      missing,
    });
  }

  const url = buildEditorBootUrl({ config });
  if (!url) {
    return buildBlockedPhase6Check({
      name: "Visual editor WordPress boot",
      missing: ["valid editor launch URL"],
    });
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Deepglot Phase 6 acceptance" },
      signal: AbortSignal.timeout(25_000),
    });
    const html = await response.text();
    const hasManifest = html.includes('id="deepglot-editor-manifest"');
    const hasSegments = html.includes("data-deepglot-segment-id");
    const hasEditorRoot = html.includes("deepglot-editor-root");
    const segmentCount = countOccurrences(html, "data-deepglot-segment-id");

    return {
      name: "Visual editor WordPress boot",
      status: response.ok && hasManifest && hasSegments && hasEditorRoot ? "PASS" : "FAIL",
      detail: `${response.status}; manifest=${hasManifest}; segments=${segmentCount}; editorRoot=${hasEditorRoot}.`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return failureCheck("Visual editor WordPress boot", error, startedAt);
  }
}

async function checkBrowserRedirectGuard(
  config: Phase6AcceptanceConfig
): Promise<AcceptanceCheck> {
  const startedAt = Date.now();
  const url = new URL("/", config.wordpressUrl);
  url.searchParams.set("deepglot_phase6", String(Date.now()));

  try {
    const response = await fetch(url, {
      redirect: "manual",
      headers: {
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Deepglot Phase 6 acceptance",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const location = response.headers.get("location");
    const isRedirect = [301, 302, 303, 307, 308].includes(response.status);

    return {
      name: "Browser-language redirect guarded rollout",
      status: !isRedirect && !location ? "PASS" : "FAIL",
      detail: `${response.status}; location=${location ?? "(none)"}.`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return failureCheck("Browser-language redirect guarded rollout", error, startedAt);
  }
}

async function checkSubdomainMappedHost(
  config: Phase6AcceptanceConfig
): Promise<AcceptanceCheck> {
  if (!config.subdomainHost) {
    return {
      name: "Subdomain mapped-host live QA",
      status: "BLOCKED",
      detail:
        "No DEEPGLOT_PHASE6_SUBDOMAIN_HOST configured; path-prefix routing remains the verified production default.",
    };
  }

  const startedAt = Date.now();
  const url = buildSubdomainAcceptanceUrl(config.subdomainHost);
  if (!url) {
    return {
      name: "Subdomain mapped-host live QA",
      status: "BLOCKED",
      detail: `Invalid DEEPGLOT_PHASE6_SUBDOMAIN_HOST value: ${config.subdomainHost}.`,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "Deepglot Phase 6 acceptance" },
      signal: AbortSignal.timeout(20_000),
    });

    return {
      name: "Subdomain mapped-host live QA",
      status: response.ok ? "PASS" : "FAIL",
      detail: `${response.status} from configured mapped host ${config.subdomainHost}.`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return failureCheck("Subdomain mapped-host live QA", error, startedAt);
  }
}

function skippedCheck(name: string, detail: string): AcceptanceCheck {
  return { name, status: "SKIPPED", detail };
}

function failureCheck(name: string, error: unknown, startedAt: number): AcceptanceCheck {
  return {
    name,
    status: "FAIL",
    detail: error instanceof Error ? error.message : String(error),
    durationMs: Date.now() - startedAt,
  };
}

function extractVisibleText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countOccurrences(value: string, needle: string) {
  return value.split(needle).length - 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prodEnvFile = loadEnvFile(options.prodEnvFile);
  const localEnvFile = loadEnvFile(options.localEnvFile);
  const acceptanceEnv = mergeAcceptanceEnv(prodEnvFile, localEnvFile);
  const commandEnv = localCommandEnv(localEnvFile);
  const config = resolvePhase6AcceptanceConfig(acceptanceEnv);
  const checks: AcceptanceCheck[] = [];

  if (options.skipLive) {
    checks.push(
      skippedCheck("WordPress translated /en/ output", "Skipped by --skip-live."),
      skippedCheck("Plugin runtime-config API", "Skipped by --skip-live."),
      skippedCheck("Visual editor WordPress boot", "Skipped by --skip-live."),
      skippedCheck(
        "Browser-language redirect guarded rollout",
        "Skipped by --skip-live."
      ),
      skippedCheck("Subdomain mapped-host live QA", "Skipped by --skip-live.")
    );
  } else {
    checks.push(await checkWordPressTranslatedPath(config));
    checks.push(await checkRuntimeConfig(config));
    checks.push(await checkVisualEditorBoot(config));
    checks.push(await checkBrowserRedirectGuard(config));
    checks.push(await checkSubdomainMappedHost(config));
  }

  checks.push(
    runNpmCheck({
      name: "WordPress PHP Phase 6 coverage",
      args: ["run", "test:wp"],
      env: commandEnv,
    })
  );

  if (options.skipE2e) {
    checks.push(
      skippedCheck("Phase 6 Playwright dashboard flows", "Skipped by --skip-e2e.")
    );
  } else {
    checks.push(
      runNpmCheck({
        name: "Phase 6 Playwright dashboard flows",
        args: ["run", "test:e2e", "--", "tests/e2e/phase-6-dashboard.spec.ts"],
        env: commandEnv,
      })
    );
  }

  const report = buildAcceptanceReport({
    name: "Deepglot Phase 6 acceptance",
    checks,
  });

  if (options.jsonFile) {
    writeReportFile(options.jsonFile, renderAcceptanceJson(report));
  }

  if (options.junitFile) {
    writeReportFile(options.junitFile, renderAcceptanceJunit(report));
  }

  console.log(renderAcceptanceText(report));
  process.exit(getAcceptanceExitCode(report, options.strict));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
