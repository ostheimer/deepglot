import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import { Client } from "pg";

import {
  buildAcceptanceReport,
  getAcceptanceExitCode,
  renderAcceptanceJson,
  renderAcceptanceJunit,
  renderAcceptanceText,
  type AcceptanceCheck,
  type AcceptanceReport,
} from "@/lib/acceptance-report";
import { resolveDatabaseUrl } from "@/lib/database-url";
import {
  assessPlanSchema,
  inspectPlanSchema,
  type PlanSchemaSnapshot,
} from "@/lib/plan-schema-acceptance";

type Options = {
  envFile: string | null;
  jsonFile: string | null;
  junitFile: string | null;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    envFile: null,
    jsonFile: null,
    junitFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--env-file" && next) {
      options.envFile = next;
      index += 1;
    } else if (arg === "--json" && next) {
      options.jsonFile = next;
      index += 1;
    } else if (arg === "--junit" && next) {
      options.junitFile = next;
      index += 1;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error("Unknown or incomplete argument.");
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: npm run acceptance:plan-schema -- [options]

Options:
  --env-file <path>  Load database environment values from a dotenv file.
  --json <path>      Write a JSON acceptance report.
  --junit <path>     Write a JUnit XML acceptance report.

The script runs read-only catalog and row-count queries. It prints only the
database hostname, enum values, and aggregate counts; credentials are never printed.`);
}

function loadEnvFile(filePath: string | null) {
  if (!filePath) {
    return;
  }

  const result = dotenv.config({ path: filePath, quiet: true });
  if (result.error) {
    throw new Error("Could not load the requested environment file.");
  }
}

function getDatabaseHostname(connectionString: string) {
  try {
    return new URL(connectionString).hostname;
  } catch {
    throw new Error("The configured database URL is invalid.");
  }
}

function buildSchemaCheck(
  hostname: string,
  snapshot: PlanSchemaSnapshot,
  durationMs: number
): AcceptanceCheck {
  const assessment = assessPlanSchema(snapshot);
  const details = [
    `Target host: ${hostname}.`,
    `Plan enum: ${snapshot.enumValues.join(", ") || "missing"}.`,
    `Deprecated PROFESSIONAL rows: Organization=${assessment.professionalOrganizations}, Subscription=${assessment.professionalSubscriptions}.`,
  ];

  if (assessment.missingPlanValues.length > 0) {
    details.push(
      `Missing canonical values: ${assessment.missingPlanValues.join(", ")}.`
    );
  }

  return {
    name: "Plan enum and deprecated row guard",
    status: assessment.ready ? "PASS" : "FAIL",
    detail: details.join(" "),
    durationMs,
  };
}

function writeReportFiles(options: Options, report: AcceptanceReport) {
  if (options.jsonFile) {
    writeReportFile(options.jsonFile, renderAcceptanceJson(report));
  }

  if (options.junitFile) {
    writeReportFile(options.junitFile, renderAcceptanceJunit(report));
  }
}

function writeReportFile(filePath: string, contents: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function getSafeErrorCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_-]{1,64}$/i.test(error.code)
  ) {
    return error.code;
  }

  return null;
}

async function runCheck(connectionString: string, hostname: string) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
  });
  const startedAt = Date.now();

  try {
    await client.connect();
    const snapshot = await inspectPlanSchema(client);
    return buildSchemaCheck(hostname, snapshot, Date.now() - startedAt);
  } catch (error) {
    const code = getSafeErrorCode(error);
    return {
      name: "Plan enum and deprecated row guard",
      status: "BLOCKED",
      detail: `Read-only schema inspection failed for host ${hostname}${
        code ? ` (database error ${code})` : ""
      }.`,
      durationMs: Date.now() - startedAt,
    } satisfies AcceptanceCheck;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFile(options.envFile);

  const connectionString = resolveDatabaseUrl();
  let check: AcceptanceCheck;

  if (!connectionString) {
    check = {
      name: "Plan enum and deprecated row guard",
      status: "BLOCKED",
      detail: "DEEPGLOT_DATABASE_URL or DATABASE_URL is required.",
    };
  } else {
    const hostname = getDatabaseHostname(connectionString);
    check = await runCheck(connectionString, hostname);
  }

  const report = buildAcceptanceReport({
    name: "Deepglot Plan schema acceptance",
    checks: [check],
  });

  writeReportFiles(options, report);
  console.log(renderAcceptanceText(report));
  process.exitCode = getAcceptanceExitCode(report, true);
}

main().catch(() => {
  console.error(
    "BLOCKED Plan schema acceptance: configuration or report setup failed; no credential details were printed."
  );
  process.exitCode = 1;
});
