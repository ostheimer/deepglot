import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const scriptPath = path.join(process.cwd(), "scripts/vercel-ignore-build.mjs");

function policyExitCode(env: Record<string, string>) {
  return spawnSync(process.execPath, [scriptPath], {
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: process.env.NODE_ENV ?? "test",
      ...env,
    },
    encoding: "utf8",
  }).status;
}

test("Vercel builds production, PR previews, and manual previews only", () => {
  assert.equal(existsSync(scriptPath), true, "the versioned policy script must exist");

  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    ignoreCommand?: string;
  };
  assert.equal(config.ignoreCommand, "node scripts/vercel-ignore-build.mjs");

  assert.equal(policyExitCode({ VERCEL_ENV: "production" }), 1);
  assert.equal(
    policyExitCode({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/with-pr",
      VERCEL_GIT_PULL_REQUEST_ID: "123",
    }),
    1,
  );
  assert.equal(
    policyExitCode({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/no-pr",
    }),
    0,
  );
  assert.equal(policyExitCode({ VERCEL_ENV: "preview" }), 1);
});
