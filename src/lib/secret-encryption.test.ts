import test from "node:test";
import assert from "node:assert/strict";

import { decryptSecret, encryptSecret } from "@/lib/secret-encryption";

const env = { AUTH_SECRET: "test-secret" };

test("encrypts and decrypts secrets without storing plaintext", () => {
  const encrypted = encryptSecret("sk-test-value", env);

  assert.match(encrypted, /^v1:/);
  assert.notEqual(encrypted, "sk-test-value");
  assert.equal(decryptSecret(encrypted, env), "sk-test-value");
});

test("rejects malformed encrypted secret payloads", () => {
  assert.throws(() => decryptSecret("plain-text", env), {
    message: "Unsupported encrypted secret format.",
  });
});
