import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

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
import { assessTargetSchemaDiff, type SchemaDriftKind } from "@/lib/target-schema-acceptance";

type Options = { envFile: string | null; jsonFile: string | null; junitFile: string | null; vercelBuildGate: boolean };
const KINDS: SchemaDriftKind[] = ["table", "column", "index", "constraint", "other"];
const PLURAL: Record<SchemaDriftKind, string> = {
  table: "tables",
  column: "columns",
  index: "indexes",
  constraint: "constraints",
  other: "other statements",
};

function parseArgs(argv: string[]): Options {
  const options: Options = { envFile: null, jsonFile: null, junitFile: null, vercelBuildGate: false };
  for (let index = 0; index < argv.length; index += 1) {
    const next = argv[index + 1];
    if (argv[index] === "--help") {
      console.log("Usage: npm run acceptance:target-schema -- [--env-file <path>] [--json <path>] [--junit <path>] [--vercel-build-gate]");
      process.exit(0);
    }
    if (argv[index] === "--vercel-build-gate") {
      options.vercelBuildGate = true;
      continue;
    }
    if (argv[index] === "--env-file" && next) options.envFile = next;
    else if (argv[index] === "--json" && next) options.jsonFile = next;
    else if (argv[index] === "--junit" && next) options.junitFile = next;
    else throw new Error("Unknown or incomplete argument.");
    index += 1;
  }
  return options;
}

function writeReports(options: Options, report: AcceptanceReport) {
  for (const [file, contents] of [
    [options.jsonFile, renderAcceptanceJson(report)],
    [options.junitFile, renderAcceptanceJunit(report)],
  ] as const) {
    if (!file) continue;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
}

function databaseHost(url: string): string {
  const parsed = new URL(url);
  if (!(["postgres:", "postgresql:"].includes(parsed.protocol) && parsed.hostname)) {
    throw new Error("Invalid PostgreSQL URL.");
  }
  return parsed.hostname;
}

function inspectTargetSchema(url: string, host: string): AcceptanceCheck[] {
  const startedAt = Date.now();
  // Prisma migrate diff is read-only. Never print its stdout (raw DDL) or
  // stderr: diagnostics can include connection details or sensitive defaults.
  const result = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
      "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DEEPGLOT_DATABASE_URL: url },
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    }
  );
  if (result.error || result.status !== 0) {
    return [{
      name: "Target schema comparison",
      status: "BLOCKED",
      detail: `Read-only Prisma schema comparison failed for host ${host}; raw diagnostics withheld.`,
      durationMs: Date.now() - startedAt,
    }];
  }

  const assessment = assessTargetSchemaDiff(result.stdout);
  return KINDS.map((kind) => {
    const count = assessment.drift.filter((item) => item.kind === kind).length;
    return {
      name: `Target schema ${PLURAL[kind]}`,
      status: count === 0 ? "PASS" : "FAIL",
      detail: `${count} pending ${kind} statement${count === 1 ? "" : "s"} on host ${host}.`,
      durationMs: Date.now() - startedAt,
    };
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.vercelBuildGate && !["preview", "production"].includes(process.env.VERCEL_ENV ?? "")) {
    console.log("Target schema build gate: local/CI build; database acceptance runs after CI database setup.");
    return;
  }
  if (options.envFile) {
    if (dotenv.config({ path: options.envFile, override: true, quiet: true }).error) {
      throw new Error("Could not load environment file.");
    }
  } else {
    dotenv.config({ quiet: true });
  }

  const url = resolveDatabaseUrl();
  const checks: AcceptanceCheck[] = !url
    ? [{ name: "Target schema comparison", status: "BLOCKED", detail: "DEEPGLOT_DATABASE_URL or DATABASE_URL is required." }]
    : inspectTargetSchema(url, databaseHost(url));
  const report = buildAcceptanceReport({ name: "Deepglot target schema acceptance", checks });
  writeReports(options, report);
  console.log(renderAcceptanceText(report));
  process.exitCode = getAcceptanceExitCode(report, true);
}

try {
  main();
} catch {
  console.error("BLOCKED Target schema acceptance: configuration or report setup failed; no credential details were printed.");
  process.exitCode = 1;
}
