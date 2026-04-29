import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectInvitationUrl,
  canSendProjectInvitationEmail,
  getProjectInvitationBaseUrl,
  getProjectInvitationExpiresAt,
  hashProjectInvitationToken,
  normalizeProjectInvitationEmail,
} from "@/lib/project-invitations";

test("normalizes invitation email addresses", () => {
  assert.equal(normalizeProjectInvitationEmail(" Translator@Example.COM "), "translator@example.com");
});

test("hashes invitation tokens deterministically without exposing the token", () => {
  const hash = hashProjectInvitationToken("invite-token");

  assert.equal(hash.length, 64);
  assert.equal(hash, hashProjectInvitationToken("invite-token"));
  assert.notEqual(hash, "invite-token");
});

test("builds localized invitation URLs", () => {
  assert.equal(
    buildProjectInvitationUrl({
      token: "abc123",
      locale: "en",
      baseUrl: "https://deepglot.ai",
    }),
    "https://deepglot.ai/accept-invite?token=abc123"
  );
  assert.equal(
    buildProjectInvitationUrl({
      token: "abc123",
      locale: "de",
      baseUrl: "https://deepglot.ai",
    }),
    "https://deepglot.ai/de/accept-invite?token=abc123"
  );
});

test("resolves invitation base URL from app or Vercel env", () => {
  assert.equal(
    getProjectInvitationBaseUrl({ NEXT_PUBLIC_APP_URL: "deepglot.ai" }),
    "https://deepglot.ai"
  );
  assert.equal(
    getProjectInvitationBaseUrl({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "deepglot-preview.vercel.app",
    }),
    "https://deepglot-preview.vercel.app"
  );
});

test("invitation links expire after seven days", () => {
  const now = new Date("2026-04-29T10:00:00.000Z");

  assert.equal(
    getProjectInvitationExpiresAt(now).toISOString(),
    "2026-05-06T10:00:00.000Z"
  );
});

test("requires Cloudflare Email Sending config for invite delivery", () => {
  assert.equal(canSendProjectInvitationEmail({}), false);
  assert.equal(
    canSendProjectInvitationEmail({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_EMAIL_API_TOKEN: "token",
      EMAIL_FROM: "Deepglot <noreply@deepglot.ai>",
    }),
    true
  );
});
