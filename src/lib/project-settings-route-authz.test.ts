import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Guardrail test for project settings-area API authorization.
//
// Every settings tab *page* gates on `requireProjectManagement` (org
// OWNER/ADMIN or project ADMIN). The matching API routes must enforce the same
// bar, otherwise a lower-privilege user (an org MEMBER, or a project
// TRANSLATOR) can perform management actions by calling the API directly —
// e.g. deleting a project, minting an API key, or wiring a webhook to an
// attacker-controlled URL.
//
// These handlers are Next.js route handlers tightly coupled to Prisma + auth,
// so unit-testing them would require a full DB/session harness. Instead we
// assert the *wiring* at the source level: each management-gated method must
// call `userCanManageProject(...)` and must NOT fall back to the weaker
// `userHasProjectAccess(...)` (which allows translators) or a bare org-member
// lookup. The access *policy* itself (who counts as a manager) is covered by
// project-access.test.ts.

const API_DIR = path.join(
  process.cwd(),
  "src",
  "app",
  "api",
  "projects",
  "[projektId]"
);

// file (relative to API_DIR) -> HTTP methods that must require management.
// GET on the project root is intentionally excluded: reading basic project
// info stays available to any organization member.
const MANAGEMENT_ROUTES: ReadonlyArray<{
  file: string;
  methods: ReadonlyArray<string>;
}> = [
  { file: "route.ts", methods: ["PATCH", "DELETE"] },
  { file: "api-keys/route.ts", methods: ["POST"] },
  { file: "api-keys/[apiKeyId]/route.ts", methods: ["DELETE"] },
  { file: "webhooks/route.ts", methods: ["GET", "POST"] },
  { file: "webhooks/[id]/route.ts", methods: ["PATCH", "DELETE"] },
  { file: "webhooks/[id]/test/route.ts", methods: ["POST"] },
  { file: "webhooks/deliveries/route.ts", methods: ["GET"] },
  { file: "webhooks/health/route.ts", methods: ["GET"] },
  { file: "exclusions/route.ts", methods: ["GET", "POST"] },
  { file: "exclusions/[exclusionId]/route.ts", methods: ["PATCH", "DELETE"] },
  { file: "members/route.ts", methods: ["GET"] },
  { file: "members/[memberId]/route.ts", methods: ["PATCH", "DELETE"] },
  { file: "members/invite/route.ts", methods: ["POST"] },
  {
    file: "members/invitations/[invitationId]/route.ts",
    methods: ["DELETE"],
  },
  {
    file: "members/invitations/[invitationId]/resend/route.ts",
    methods: ["POST"],
  },
  { file: "language-model/route.ts", methods: ["GET", "PATCH"] },
];

/**
 * Return the source of a single exported route handler (the text from
 * `export async function METHOD(` up to the next top-level `export`, or EOF).
 */
function methodBody(source: string, method: string): string | null {
  const marker = `export async function ${method}(`;
  const start = source.indexOf(marker);
  if (start === -1) return null;

  const rest = source.slice(start + marker.length);
  const nextExport = rest.indexOf("\nexport ");
  return nextExport === -1 ? rest : rest.slice(0, nextExport);
}

test("settings-area API directory resolves", () => {
  assert.ok(
    existsSync(API_DIR),
    `expected project API dir at ${API_DIR} (run tests from the repo root)`
  );
});

for (const route of MANAGEMENT_ROUTES) {
  test(`settings API ${route.file} gates ${route.methods.join(
    "/"
  )} on project management`, () => {
    const source = readFileSync(path.join(API_DIR, route.file), "utf8");

    for (const method of route.methods) {
      const body = methodBody(source, method);
      assert.ok(body, `${route.file} should export an async ${method} handler`);

      assert.ok(
        body.includes("userCanManageProject("),
        `${route.file} ${method} must authorize via userCanManageProject(...)`
      );
      assert.ok(
        !body.includes("userHasProjectAccess("),
        `${route.file} ${method} must NOT use userHasProjectAccess(...) — it allows translators`
      );
    }
  });
}
