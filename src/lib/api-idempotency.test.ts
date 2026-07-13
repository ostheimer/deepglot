import assert from "node:assert/strict";
import test from "node:test";

import {
  API_IDEMPOTENCY_KEY_MAX_LENGTH,
  API_IDEMPOTENCY_RETENTION_MS,
  MemoryApiIdempotencyStore,
  executeIdempotently,
  hashApiIdempotencyKey,
  hashApiIdempotencyRequestBody,
  validateApiIdempotencyKey,
} from "@/lib/api-idempotency";

const okResponse = {
  status: 200,
  headers: { "content-type": "application/json" },
  body: { from_words: ["Hallo"], to_words: ["Hello"] },
};

test("hashes raw keys and canonical request bodies and enforces the public key bound", () => {
  const keyHash = hashApiIdempotencyKey("raw-secret-retry-key");
  assert.equal(keyHash.length, 64);
  assert.ok(!keyHash.includes("raw-secret-retry-key"));
  assert.equal(
    hashApiIdempotencyRequestBody({ b: 2, a: { y: 2, x: 1 } }),
    hashApiIdempotencyRequestBody({ a: { x: 1, y: 2 }, b: 2 }),
  );
  assert.notEqual(
    hashApiIdempotencyRequestBody({ words: ["Hallo"] }),
    hashApiIdempotencyRequestBody({ words: ["Tschüss"] }),
  );
  assert.equal(API_IDEMPOTENCY_RETENTION_MS, 24 * 60 * 60 * 1_000);
  assert.equal(validateApiIdempotencyKey(""), false);
  assert.equal(validateApiIdempotencyKey("x"), true);
  assert.equal(
    validateApiIdempotencyKey("x".repeat(API_IDEMPOTENCY_KEY_MAX_LENGTH + 1)),
    false,
  );
});

test("replays the first completed response without executing provider or usage side effects twice", async () => {
  const store = new MemoryApiIdempotencyStore();
  let providerCalls = 0;
  let usageIncrements = 0;
  const execute = async () => {
    providerCalls += 1;
    usageIncrements += 1;
    return okResponse;
  };

  const first = await executeIdempotently({
    scope: "api-key-1:/api/translate",
    key: "retry-123",
    requestBody: { l_from: "de", l_to: "en", words: [{ w: "Hallo", t: 1 }] },
    store,
    execute,
  });
  const retry = await executeIdempotently({
    scope: "api-key-1:/api/translate",
    key: "retry-123",
    requestBody: { words: [{ t: 1, w: "Hallo" }], l_to: "en", l_from: "de" },
    store,
    execute,
  });

  assert.equal(first.kind, "executed");
  assert.equal(retry.kind, "replayed");
  assert.deepEqual(retry.response, first.response);
  assert.equal(providerCalls, 1);
  assert.equal(usageIncrements, 1);
});

test("rejects reuse of a key with a different request body", async () => {
  const store = new MemoryApiIdempotencyStore();
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return okResponse;
  };

  await executeIdempotently({
    scope: "api-key-1:/api/translate",
    key: "conflict-123",
    requestBody: { l_from: "de", l_to: "en", words: [{ w: "Hallo", t: 1 }] },
    store,
    execute,
  });
  const conflict = await executeIdempotently({
    scope: "api-key-1:/api/translate",
    key: "conflict-123",
    requestBody: { l_from: "de", l_to: "en", words: [{ w: "Tschüss", t: 1 }] },
    store,
    execute,
  });

  assert.deepEqual(conflict, { kind: "conflict" });
  assert.equal(executions, 1);
});

test("coalesces concurrent duplicate requests around one execution", async () => {
  const store = new MemoryApiIdempotencyStore();
  let executions = 0;
  let releaseExecution!: () => void;
  const executionGate = new Promise<void>((resolve) => {
    releaseExecution = resolve;
  });
  const execute = async () => {
    executions += 1;
    await executionGate;
    return okResponse;
  };
  const request = {
    scope: "api-key-1:/api/translate",
    key: "concurrent-123",
    requestBody: { l_from: "de", l_to: "en", words: [{ w: "Neu", t: 1 }] },
    store,
    execute,
  };

  const firstPromise = executeIdempotently(request);
  const secondPromise = executeIdempotently(request);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(executions, 1);
  releaseExecution();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.deepEqual(
    [first.kind, second.kind].sort(),
    ["executed", "replayed"]
  );
  assert.deepEqual(first.response, second.response);
});

test("replays completed error responses but releases a failed execution for retry", async () => {
  const store = new MemoryApiIdempotencyStore();
  let errorExecutions = 0;
  const errorResponse = {
    status: 503,
    headers: { "content-type": "application/problem+json" },
    body: { code: "provider_unavailable" },
  };
  const first = await executeIdempotently({
    scope: "api-key-1:/api/translate",
    key: "completed-error",
    requestBody: { words: [{ w: "Hallo", t: 1 }] },
    store,
    execute: async () => {
      errorExecutions += 1;
      return errorResponse;
    },
  });
  const replay = await executeIdempotently({
    scope: "api-key-1:/api/translate",
    key: "completed-error",
    requestBody: { words: [{ w: "Hallo", t: 1 }] },
    store,
    execute: async () => {
      errorExecutions += 1;
      return okResponse;
    },
  });
  assert.equal(first.kind, "executed");
  assert.equal(replay.kind, "replayed");
  assert.deepEqual(replay.response, errorResponse);
  assert.equal(errorExecutions, 1);

  let thrownExecutions = 0;
  await assert.rejects(
    executeIdempotently({
      scope: "api-key-1:/api/translate",
      key: "thrown-error",
      requestBody: { words: [{ w: "Retry", t: 1 }] },
      store,
      execute: async () => {
        thrownExecutions += 1;
        throw new Error("connection reset");
      },
    }),
    /connection reset/
  );
  const recovered = await executeIdempotently({
    scope: "api-key-1:/api/translate",
    key: "thrown-error",
    requestBody: { words: [{ w: "Retry", t: 1 }] },
    store,
    execute: async () => {
      thrownExecutions += 1;
      return okResponse;
    },
  });
  assert.equal(recovered.kind, "executed");
  assert.equal(thrownExecutions, 2);
});

test("allows a key to execute again after its bounded retention expires", async () => {
  const store = new MemoryApiIdempotencyStore();
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return okResponse;
  };
  const base = {
    scope: "api-key-1:/api/translate",
    key: "expiring-key",
    requestBody: { words: [{ w: "Hallo", t: 1 }] },
    retentionMs: 60_000,
    store,
    execute,
  };

  await executeIdempotently({ ...base, now: new Date("2026-07-13T10:00:00Z") });
  const replay = await executeIdempotently({
    ...base,
    now: new Date("2026-07-13T10:00:30Z"),
  });
  const expired = await executeIdempotently({
    ...base,
    now: new Date("2026-07-13T10:01:01Z"),
  });

  assert.equal(replay.kind, "replayed");
  assert.equal(expired.kind, "executed");
  assert.equal(executions, 2);
});

test("only reclaims a stale processing lease for the same request body", async () => {
  const store = new MemoryApiIdempotencyStore();
  const base = {
    scope: "api-key-1:/api/translate",
    keyHash: hashApiIdempotencyKey("leased-key"),
    requestHash: hashApiIdempotencyRequestBody({ words: ["Hallo"] }),
    expiresAt: new Date("2026-07-14T10:00:00Z"),
  };

  assert.deepEqual(
    await store.claim({
      ...base,
      ownerToken: "owner-1",
      now: new Date("2026-07-13T10:00:00Z"),
      leaseExpiresAt: new Date("2026-07-13T10:01:00Z"),
    }),
    { kind: "acquired" },
  );
  assert.deepEqual(
    await store.claim({
      ...base,
      ownerToken: "owner-2",
      now: new Date("2026-07-13T10:00:30Z"),
      leaseExpiresAt: new Date("2026-07-13T10:01:30Z"),
    }),
    {
      kind: "processing",
      leaseExpiresAt: new Date("2026-07-13T10:01:00Z"),
    },
  );
  assert.deepEqual(
    await store.claim({
      ...base,
      ownerToken: "owner-3",
      now: new Date("2026-07-13T10:01:01Z"),
      leaseExpiresAt: new Date("2026-07-13T10:02:01Z"),
    }),
    { kind: "acquired" },
  );
  assert.deepEqual(
    await store.claim({
      ...base,
      requestHash: hashApiIdempotencyRequestBody({ words: ["Anders"] }),
      ownerToken: "owner-4",
      now: new Date("2026-07-13T10:02:02Z"),
      leaseExpiresAt: new Date("2026-07-13T10:03:02Z"),
    }),
    { kind: "conflict" },
  );
});

test("deletes physically expired records through the cleanup contract", async () => {
  const store = new MemoryApiIdempotencyStore();
  await executeIdempotently({
    scope: "api-key-1:/api/translate",
    key: "cleanup-key",
    requestBody: { words: ["Hallo"] },
    store,
    now: new Date("2026-07-13T10:00:00Z"),
    retentionMs: 1_000,
    execute: async () => okResponse,
  });

  assert.equal(await store.deleteExpired(new Date("2026-07-13T10:00:30Z")), 1);
  assert.equal(await store.deleteExpired(new Date("2026-07-13T10:00:31Z")), 0);
});
