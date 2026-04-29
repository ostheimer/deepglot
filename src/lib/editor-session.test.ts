import assert from "node:assert/strict";
import test from "node:test";

import {
  createEditorSessionToken,
  getEditorSessionSecret,
  verifyEditorSessionToken,
} from "@/lib/editor-session";

test("creates and verifies editor session tokens", () => {
  const secret = "test-editor-secret";
  const token = createEditorSessionToken(
    { projectId: "proj_123", domain: "example.com", ttlSeconds: 60 },
    secret
  );

  const claims = verifyEditorSessionToken(token, secret, Date.now());

  assert.ok(claims);
  assert.equal(claims.projectId, "proj_123");
  assert.equal(claims.domain, "example.com");
});

test("rejects tampered editor session tokens", () => {
  const secret = "test-editor-secret";
  const token = createEditorSessionToken(
    { projectId: "proj_123", domain: "example.com", ttlSeconds: 60 },
    secret
  );

  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

  assert.equal(verifyEditorSessionToken(tampered, secret, Date.now()), null);
});

test("rejects expired editor session tokens", () => {
  const secret = "test-editor-secret";
  const token = createEditorSessionToken(
    { projectId: "proj_123", domain: "example.com", ttlSeconds: 1 },
    secret
  );

  assert.equal(
    verifyEditorSessionToken(token, secret, Date.now() + 5_000),
    null
  );
});

test("uses a development fallback editor secret in test mode", () => {
  const secret = getEditorSessionSecret({ NODE_ENV: "test" });

  assert.equal(secret, "deepglot-editor-local-development-secret");
});

test("ignores empty editor secret before falling back to auth secret", () => {
  const secret = getEditorSessionSecret({
    DEEPGLOT_EDITOR_SECRET: " ",
    AUTH_SECRET: "auth-secret",
  });

  assert.equal(secret, "auth-secret");
});
