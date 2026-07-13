import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROUTE_PATH = path.join(
  process.cwd(),
  "src/app/api/translate/route.ts",
);

function routeSource() {
  return readFileSync(ROUTE_PATH, "utf8");
}

test("translate claims an idempotency key after auth and before every side effect", () => {
  const source = routeSource();
  const post = source.slice(source.indexOf("export async function POST"));
  const validateIndex = post.indexOf("await validateApiKey(rawKey)");
  const claimIndex = post.indexOf("await executeIdempotently(");
  const executeIndex = post.indexOf("executeAuthenticatedTranslateRequest(", claimIndex);

  assert.ok(validateIndex >= 0, "POST must validate the API key");
  assert.ok(claimIndex > validateIndex, "the idempotency claim must follow API-key validation");
  assert.ok(executeIndex > claimIndex, "the side-effect pipeline must be the claim's execute callback");
  assert.equal(
    post.slice(validateIndex, claimIndex).includes("consumeRateLimit("),
    false,
    "rate limiting must not run before the idempotency claim",
  );
  assert.match(
    post,
    /rawIdempotencyKey === null[\s\S]{0,160}executeAuthenticatedTranslateRequest/,
    "requests without Idempotency-Key must keep the existing direct path",
  );
});

test("one idempotency owner encloses provider, usage, cache analytics, webhooks, and bot guards", () => {
  const source = routeSource();
  const pipeline = source.slice(
    source.indexOf("async function executeAuthenticatedTranslateRequest"),
    source.indexOf("const translateIdempotencyStore"),
  );

  assert.match(pipeline, /consumeRateLimit\(/);
  assert.match(pipeline, /translateTexts\(/, "provider calls must stay in the owned pipeline");
  assert.match(
    pipeline,
    /incrementUsageRecord\(/,
    "quota accounting must stay in the owned pipeline",
  );
  assert.match(pipeline, /recordTranslationBatch\(/);
  assert.match(pipeline, /queueProjectWebhookEvent\(/);
  assert.match(pipeline, /const isBot = bot >= BotType\.OTHER/);
  assert.match(
    pipeline,
    /pendingTranslations\.length > 0 && !isBot/,
    "bots must remain cache-only after idempotency wrapping",
  );

  const post = source.slice(source.indexOf("export async function POST"));
  assert.match(
    post,
    /execute:\s*async \(\) =>[\s\S]{0,240}executeAuthenticatedTranslateRequest/,
    "the idempotency executor must call the complete authenticated pipeline",
  );
});

test("Prisma schema and the authenticated cron provide bounded physical retention", () => {
  const schema = readFileSync(
    path.join(process.cwd(), "prisma/schema.prisma"),
    "utf8",
  );
  const cronRoute = readFileSync(
    path.join(process.cwd(), "src/app/api/webhooks/process/route.ts"),
    "utf8",
  );
  const workflow = readFileSync(
    path.join(process.cwd(), ".github/workflows/ci-cd.yml"),
    "utf8",
  );
  const packageJson = JSON.parse(
    readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };

  assert.match(schema, /model ApiIdempotencyRecord/);
  assert.match(schema, /@@unique\(\[scope, keyHash\]\)/);
  assert.match(schema, /@@index\(\[expiresAt\]\)/);
  assert.match(cronRoute, /pruneExpiredApiIdempotencyRecords/);
  assert.match(
    cronRoute,
    /pruneExpiredApiIdempotencyRecords\(\)\.catch\(/,
    "cleanup failures must not fail webhook delivery processing",
  );
  assert.equal(
    packageJson.scripts?.["test:integration"],
    "node --import tsx --test tests/integration/*.test.ts",
  );
  assert.match(workflow, /npx prisma db push[\s\S]*npm run test:integration/);
});
