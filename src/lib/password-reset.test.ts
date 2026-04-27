import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPasswordResetUrl,
  canSendPasswordResetEmail,
  getPasswordResetBaseUrl,
  getPasswordResetExpiresAt,
  getPasswordResetIdentifier,
  hashPasswordResetToken,
  normalizePasswordResetEmail,
} from "@/lib/password-reset";

test("normalizes emails and namespaces reset identifiers", () => {
  assert.equal(normalizePasswordResetEmail(" Office@Ostheimer.AT "), "office@ostheimer.at");
  assert.equal(
    getPasswordResetIdentifier(" Office@Ostheimer.AT "),
    "password-reset:office@ostheimer.at"
  );
});

test("hashes reset tokens without storing the raw token", () => {
  const hash = hashPasswordResetToken("reset-token");

  assert.equal(hash.length, 64);
  assert.notEqual(hash, "reset-token");
  assert.equal(hash, hashPasswordResetToken("reset-token"));
});

test("builds localized reset URLs", () => {
  assert.equal(
    buildPasswordResetUrl({
      token: "abc123",
      locale: "en",
      baseUrl: "https://deepglot.ai",
    }),
    "https://deepglot.ai/reset-password?token=abc123"
  );
  assert.equal(
    buildPasswordResetUrl({
      token: "abc123",
      locale: "de",
      baseUrl: "https://deepglot.ai",
    }),
    "https://deepglot.ai/de/reset-password?token=abc123"
  );
});

test("uses explicit and Vercel base URLs for reset links", () => {
  assert.equal(
    getPasswordResetBaseUrl({
      AUTH_URL: "https://auth.deepglot.test",
      NEXT_PUBLIC_APP_URL: "https://app.deepglot.test",
    }),
    "https://auth.deepglot.test"
  );
  assert.equal(
    getPasswordResetBaseUrl({
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "deepglot.ai",
    }),
    "https://deepglot.ai"
  );
});

test("sets one-hour token expiry", () => {
  const now = new Date("2026-04-27T12:00:00.000Z");
  assert.equal(getPasswordResetExpiresAt(now).toISOString(), "2026-04-27T13:00:00.000Z");
});

test("requires Cloudflare Email Sending configuration for reset email delivery", () => {
  assert.equal(canSendPasswordResetEmail({}), false);
  assert.equal(canSendPasswordResetEmail({ CLOUDFLARE_ACCOUNT_ID: "account" }), false);
  assert.equal(canSendPasswordResetEmail({ EMAIL_FROM: "Deepglot <noreply@deepglot.ai>" }), false);
  assert.equal(
    canSendPasswordResetEmail({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_EMAIL_API_TOKEN: "token",
    }),
    false
  );
  assert.equal(
    canSendPasswordResetEmail({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_EMAIL_API_TOKEN: "token",
      EMAIL_FROM: "Deepglot <noreply@deepglot.ai>",
    }),
    true
  );
});
