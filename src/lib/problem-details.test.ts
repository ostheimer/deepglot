import assert from "node:assert/strict";
import test from "node:test";

import { apiProblem, validationProblem } from "@/lib/problem-details";

test("returns a stable Problem Details response while preserving the legacy error field", async () => {
  const response = apiProblem({
    status: 401,
    title: "Authentication required",
    detail: "Missing API key.",
    code: "missing_api_key",
    instance: "/api/plugin/runtime-config",
  });

  assert.equal(response.status, 401);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/problem\+json/
  );
  assert.deepEqual(await response.json(), {
    type: "https://deepglot.ai/problems/missing-api-key",
    title: "Authentication required",
    status: 401,
    detail: "Missing API key.",
    code: "missing_api_key",
    instance: "/api/plugin/runtime-config",
    error: "Missing API key.",
  });
});

test("includes field-level validation details in the shared error contract", async () => {
  const response = validationProblem({
    detail: "languageFrom and languageTo are required.",
    instance: "/api/public/languages/is-supported",
    errors: {
      languageFrom: ["Required"],
      languageTo: ["Required"],
    },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    type: "https://deepglot.ai/problems/validation-failed",
    title: "Validation failed",
    status: 400,
    detail: "languageFrom and languageTo are required.",
    code: "validation_failed",
    instance: "/api/public/languages/is-supported",
    error: "languageFrom and languageTo are required.",
    errors: {
      languageFrom: ["Required"],
      languageTo: ["Required"],
    },
  });
});

test("preserves response headers and route-specific extension fields", async () => {
  const response = apiProblem({
    status: 429,
    title: "Rate limit exceeded",
    detail: "Try again later.",
    code: "rate_limit_exceeded",
    instance: "/api/translate",
    extensions: { retry_after: 42 },
    headers: {
      "Retry-After": "42",
      "X-RateLimit-Remaining": "0",
    },
  });

  assert.equal(response.headers.get("retry-after"), "42");
  assert.equal(response.headers.get("x-ratelimit-remaining"), "0");
  assert.equal((await response.json()).retry_after, 42);
});
