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
  summarizeAcceptanceReport,
  type AcceptanceCheck,
  type AcceptanceReport,
} from "@/lib/acceptance-report";
import {
  buildNeonLiveReadinessCheck,
  buildRateLimitReadinessCheck,
  buildStripeReadinessCheck,
  buildWebhookProcessorReadinessCheck,
  redactAcceptanceOutput,
} from "@/lib/production-acceptance";
import type { NeonRestoreDrillEnv } from "@/lib/neon-restore-drill";
import type { StripeAcceptanceEnv } from "@/lib/stripe-acceptance";

type Options = {
  prodEnvFile: string;
  localEnvFile: string;
  jsonFile: string | null;
  junitFile: string | null;
  strict: boolean;
  skipSmoke: boolean;
  skipLive: boolean;
  runWebhookProcessor: boolean;
  createNeonBranch: boolean;
};

type LoadedEnvFile = {
  path: string;
  exists: boolean;
  values: Record<string, string>;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    prodEnvFile: ".env.production.local",
    localEnvFile: ".env.local",
    jsonFile: null,
    junitFile: null,
    strict: false,
    skipSmoke: false,
    skipLive: false,
    runWebhookProcessor: false,
    createNeonBranch: false,
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
    } else if (arg === "--skip-smoke") {
      options.skipSmoke = true;
    } else if (arg === "--skip-live") {
      options.skipLive = true;
    } else if (arg === "--run-webhook-processor") {
      options.runWebhookProcessor = true;
    } else if (arg === "--create-neon-branch") {
      options.createNeonBranch = true;
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
  console.log(`Usage: npm run acceptance:production -- [options]

Options:
  --prod-env-file <path>       Production dotenv file. Default: .env.production.local
  --local-env-file <path>      Local/test dotenv file. Default: .env.local
  --json <path>                Write a JSON report.
  --junit <path>               Write a JUnit XML report.
  --strict                     Exit non-zero for blocked or skipped checks.
  --skip-smoke                 Skip npm run smoke:production.
  --skip-live                  Skip SaaS and Phase 6 production HTTP/API checks.
  --run-webhook-processor      Call /api/webhooks/process with CRON_SECRET.
  --create-neon-branch         Create the temporary Neon restore-drill branch.

Default mode is non-destructive. It runs smoke checks, dry-run/readiness checks,
and read-only Stripe API validation only when live Stripe configuration is complete.`);
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

function envFileArgs(envFile: LoadedEnvFile) {
  return envFile.exists ? ["--env-file", envFile.path] : [];
}

function writeReportFile(filePath: string, contents: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function runNpmCheck({
  name,
  args,
  env,
}: {
  name: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}): AcceptanceCheck {
  const startedAt = Date.now();
  const result = spawnSync("npm", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
  });
  const durationMs = Date.now() - startedAt;
  const output = summarizeChildOutput(result.stdout, result.stderr);

  return {
    name,
    status: result.status === 0 ? "PASS" : "FAIL",
    detail: output || `npm ${args.join(" ")} exited with ${result.status ?? "unknown status"}.`,
    durationMs,
  };
}

function runNestedAcceptanceCheck({
  name,
  args,
  env,
}: {
  name: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}): AcceptanceCheck {
  const startedAt = Date.now();
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const reportPath = path.join(
    "output",
    `nested-${safeName}-${process.pid}-${startedAt}.json`
  );
  const result = spawnSync("npm", [...args, "--json", reportPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
  });
  const durationMs = Date.now() - startedAt;
  const nestedReport = readNestedReport(reportPath);

  if (nestedReport) {
    const summary = summarizeAcceptanceReport(nestedReport);
    const status =
      summary.failed > 0
        ? "FAIL"
        : summary.blocked > 0
          ? "BLOCKED"
          : summary.skipped > 0
            ? "SKIPPED"
            : "PASS";

    return {
      name,
      status,
      detail: `${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.blocked} blocked, ${summary.skipped} skipped. Report: ${reportPath}.`,
      durationMs,
    };
  }

  const output = summarizeChildOutput(result.stdout, result.stderr);

  return {
    name,
    status: result.status === 0 ? "PASS" : "FAIL",
    detail: output || `npm ${args.join(" ")} exited with ${result.status ?? "unknown status"}.`,
    durationMs,
  };
}

function readNestedReport(reportPath: string): AcceptanceReport | null {
  if (!existsSync(reportPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(reportPath, "utf8")) as AcceptanceReport;
  } catch {
    return null;
  }
}

function summarizeChildOutput(stdout: string | null, stderr: string | null) {
  const lines = `${stdout ?? ""}\n${stderr ?? ""}`
    .split(/\r?\n/)
    .map((line) => redactAcceptanceOutput(line.trim()))
    .filter(Boolean);

  return lines.slice(-6).join(" | ");
}

async function runWebhookProcessorCheck({
  baseUrl,
  cronSecret,
}: {
  baseUrl: string;
  cronSecret: string;
}): Promise<AcceptanceCheck> {
  const startedAt = Date.now();
  const url = new URL("/api/webhooks/process", normalizeUrl(baseUrl));

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "User-Agent": "Deepglot production acceptance",
      },
    });
    const body = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          processed?: number;
          delivered?: number;
          failed?: number;
          pendingRemaining?: number;
          durationMs?: number;
          error?: string;
        }
      | null;

    return {
      name: "Webhook processor execution",
      status: response.ok && body?.ok === true ? "PASS" : "FAIL",
      detail:
        body?.ok === true
          ? `processed=${body.processed ?? 0}, delivered=${body.delivered ?? 0}, failed=${body.failed ?? 0}, pendingRemaining=${body.pendingRemaining ?? 0}.`
          : `${response.status} ${response.statusText}; ${body?.error ?? "unexpected response"}`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name: "Webhook processor execution",
      status: "FAIL",
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

function normalizeUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`;
}

function getProductionBaseUrl(env: Record<string, string | undefined>) {
  return (
    env.DEEPGLOT_PRODUCTION_URL ??
    env.NEXT_PUBLIC_APP_URL ??
    env.AUTH_URL ??
    "https://deepglot.ai"
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prodEnvFile = loadEnvFile(options.prodEnvFile);
  const localEnvFile = loadEnvFile(options.localEnvFile);
  const prodEnv = {
    ...process.env,
    ...prodEnvFile.values,
  };
  const localEnv = {
    ...process.env,
    ...localEnvFile.values,
  };
  const checks: AcceptanceCheck[] = [];

  if (!options.skipSmoke) {
    checks.push(
      runNpmCheck({
        name: "Production smoke",
        args: ["run", "smoke:production"],
        env: prodEnv,
      })
    );
  } else {
    checks.push({
      name: "Production smoke",
      status: "SKIPPED",
      detail: "Skipped by --skip-smoke.",
    });
  }

  checks.push(
    runNpmCheck({
      name: "Neon restore-drill dry run",
      args: ["run", "acceptance:neon", "--", ...envFileArgs(prodEnvFile)],
      env: prodEnv,
    })
  );

  const neonReadiness = buildNeonLiveReadinessCheck(prodEnv as NeonRestoreDrillEnv);
  checks.push(neonReadiness);

  if (options.createNeonBranch) {
    if (neonReadiness.status === "PASS") {
      checks.push(
        runNpmCheck({
          name: "Neon restore-drill branch creation",
          args: [
            "run",
            "acceptance:neon",
            "--",
            ...envFileArgs(prodEnvFile),
            "--create",
          ],
          env: prodEnv,
        })
      );
    } else {
      checks.push({
        name: "Neon restore-drill branch creation",
        status: "BLOCKED",
        detail: neonReadiness.detail,
      });
    }
  }

  const stripeLiveReadiness = buildStripeReadinessCheck({
    mode: "live",
    env: prodEnv as StripeAcceptanceEnv,
  });
  checks.push(stripeLiveReadiness);

  if (stripeLiveReadiness.status === "PASS") {
    checks.push(
      runNpmCheck({
        name: "Stripe live read-only API validation",
        args: ["run", "acceptance:stripe", "--", "--mode", "live", ...envFileArgs(prodEnvFile)],
        env: prodEnv,
      })
    );
  }

  const stripeTestReadiness = buildStripeReadinessCheck({
    mode: "test",
    env: localEnv as StripeAcceptanceEnv,
  });
  checks.push(stripeTestReadiness);

  if (stripeTestReadiness.status === "PASS") {
    checks.push(
      runNpmCheck({
        name: "Stripe test env-only validation",
        args: [
          "run",
          "acceptance:stripe",
          "--",
          "--mode",
          "test",
          ...envFileArgs(localEnvFile),
          "--env-only",
        ],
        env: localEnv,
      })
    );
  }

  checks.push(
    buildRateLimitReadinessCheck({
      TRANSLATE_RATE_LIMIT_PER_MINUTE: prodEnv.TRANSLATE_RATE_LIMIT_PER_MINUTE,
      PLUGIN_RATE_LIMIT_PER_MINUTE: prodEnv.PLUGIN_RATE_LIMIT_PER_MINUTE,
      AUTH_RATE_LIMIT_PER_MINUTE: prodEnv.AUTH_RATE_LIMIT_PER_MINUTE,
    })
  );

  const webhookReadiness = buildWebhookProcessorReadinessCheck({
    cronSecret: prodEnv.CRON_SECRET,
    runRequested: options.runWebhookProcessor,
  });
  checks.push(webhookReadiness);

  if (options.runWebhookProcessor && webhookReadiness.status === "PASS" && prodEnv.CRON_SECRET) {
    checks.push(
      await runWebhookProcessorCheck({
        baseUrl: getProductionBaseUrl(prodEnv),
        cronSecret: prodEnv.CRON_SECRET,
      })
    );
  }

  checks.push(
    runNestedAcceptanceCheck({
      name: "SaaS acceptance",
      args: [
        "run",
        "acceptance:saas",
        "--",
        "--prod-env-file",
        options.prodEnvFile,
        "--local-env-file",
        options.localEnvFile,
        ...(options.skipLive ? ["--skip-live"] : []),
      ],
      env: localEnv,
    })
  );

  checks.push(
    runNestedAcceptanceCheck({
      name: "Phase 6 acceptance",
      args: [
        "run",
        "acceptance:phase6",
        "--",
        "--prod-env-file",
        options.prodEnvFile,
        "--local-env-file",
        options.localEnvFile,
        ...(options.skipLive ? ["--skip-live"] : []),
      ],
      env: localEnv,
    })
  );

  const report = buildAcceptanceReport({
    name: "Deepglot production acceptance",
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
