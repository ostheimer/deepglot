import { spawnSync } from "node:child_process";

import dotenv from "dotenv";
import { Client } from "pg";

import {
  buildNeonRestoreDrillBranchName,
  getNeonRestoreDrillExpiresAt,
  getNeonRestoreDrillValidation,
  type NeonRestoreDrillEnv,
} from "@/lib/neon-restore-drill";

type Options = {
  create: boolean;
  envFile: string | null;
  projectId: string | null;
  sourceBranch: string;
  branchName: string;
  expiresHours: number;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    create: false,
    envFile: null,
    projectId: null,
    sourceBranch: "prod",
    branchName: buildNeonRestoreDrillBranchName(),
    expiresHours: 24,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--create") {
      options.create = true;
    } else if (arg === "--env-file" && next) {
      options.envFile = next;
      index += 1;
    } else if (arg === "--project-id" && next) {
      options.projectId = next;
      index += 1;
    } else if (arg === "--source-branch" && next) {
      options.sourceBranch = next;
      index += 1;
    } else if (arg === "--branch-name" && next) {
      options.branchName = next;
      index += 1;
    } else if (arg === "--expires-hours" && next) {
      options.expiresHours = Number(next);
      index += 1;
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
  console.log(`Usage: npm run acceptance:neon -- [options]

Options:
  --create                 Create a temporary Neon branch. Omit for dry-run validation.
  --env-file <path>        Load environment values from a dotenv file.
  --project-id <id>        Neon project ID. Falls back to NEON_PROJECT_ID or Neon context.
  --source-branch <name>   Production source branch. Default: prod
  --branch-name <name>     Temporary branch name. Default: restore-drill-prod-<timestamp>
  --expires-hours <hours>  Set Neon branch expiration. Default: 24

The script never writes to the source branch. It creates only a temporary child branch when --create is provided.`);
}

function loadEnvFile(path: string | null) {
  if (!path) {
    return;
  }

  const result = dotenv.config({ path, quiet: true });
  if (result.error) {
    throw result.error;
  }
}

function neonArgs(args: string[], projectId: string | null) {
  return projectId ? [...args, "--project-id", projectId] : args;
}

function runNeon(args: string[], projectId: string | null) {
  const result = spawnSync("npx", ["-y", "neonctl", ...neonArgs(args, projectId)], {
    encoding: "utf8",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "neonctl command failed");
  }

  return result.stdout.trim();
}

async function validateBranchConnection(connectionString: string) {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    const result = await client.query<{
      user_table_exists: boolean;
      project_table_exists: boolean;
      rate_limit_table_exists: boolean;
    }>(`
      SELECT
        to_regclass('public."User"') IS NOT NULL AS user_table_exists,
        to_regclass('public."Project"') IS NOT NULL AS project_table_exists,
        to_regclass('public."RateLimitBucket"') IS NOT NULL AS rate_limit_table_exists
    `);
    const row = result.rows[0];

    if (!row?.user_table_exists || !row.project_table_exists || !row.rate_limit_table_exists) {
      throw new Error("Restore-drill branch is reachable but required tables are missing.");
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFile(options.envFile);

  const projectId = options.projectId ?? process.env.NEON_PROJECT_ID ?? null;
  const validation = getNeonRestoreDrillValidation({
    env: process.env as NeonRestoreDrillEnv,
    create: options.create,
    sourceBranch: options.sourceBranch,
    branchName: options.branchName,
  });

  if (!validation.ok) {
    console.error("FAIL Neon restore-drill validation:");
    validation.errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  if (!options.create) {
    console.log(
      `PASS Neon restore-drill dry run: would create ${options.branchName} from ${options.sourceBranch}.`
    );
    return;
  }

  const expiresAt = getNeonRestoreDrillExpiresAt(new Date(), options.expiresHours);
  runNeon(
    [
      "branches",
      "create",
      "--name",
      options.branchName,
      "--parent",
      options.sourceBranch,
      "--expires-at",
      expiresAt,
      "--output",
      "json",
    ],
    projectId
  );

  const connectionString = runNeon(
    ["connection-string", options.branchName, "--pooled"],
    projectId
  );

  await validateBranchConnection(connectionString);

  console.log(
    `PASS Neon restore drill: ${options.branchName} was created from ${options.sourceBranch}, validated, and expires at ${expiresAt}.`
  );
  console.log("Cleanup: delete the temporary branch in Neon if you do not want to wait for TTL expiry.");
}

main().catch((error) => {
  console.error("FAIL Neon restore drill:", error instanceof Error ? error.message : error);
  process.exit(1);
});
