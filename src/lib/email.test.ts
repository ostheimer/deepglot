import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCloudflareEmailApiUrl,
  buildDuplicateSubscriptionAlertEmailPayload,
  buildPasswordResetEmailPayload,
  buildProjectInvitationEmailPayload,
  canSendEmail,
  getBillingAlertRecipient,
  getCloudflareEmailConfig,
  sendDuplicateSubscriptionAlertEmail,
  sendPasswordResetEmail,
  sendProjectInvitationEmail,
} from "@/lib/email";

test("detects complete Cloudflare Email Sending configuration", () => {
  assert.equal(getCloudflareEmailConfig({}), null);
  assert.equal(canSendEmail({ CLOUDFLARE_ACCOUNT_ID: "account" }), false);
  assert.equal(
    canSendEmail({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_EMAIL_API_TOKEN: "token",
      EMAIL_FROM: "Deepglot <noreply@deepglot.ai>",
    }),
    true
  );
  assert.deepEqual(
    getCloudflareEmailConfig({
      CLOUDFLARE_ACCOUNT_ID: " account ",
      CLOUDFLARE_EMAIL_API_TOKEN: " token ",
      EMAIL_FROM: " Deepglot <noreply@deepglot.ai> ",
    }),
    {
      accountId: "account",
      apiToken: "token",
      from: "Deepglot <noreply@deepglot.ai>",
    }
  );
});

test("builds Cloudflare Email Sending API URL", () => {
  assert.equal(
    buildCloudflareEmailApiUrl("account/id"),
    "https://api.cloudflare.com/client/v4/accounts/account%2Fid/email/sending/send"
  );
});

test("builds localized password reset email payloads", () => {
  const payload = buildPasswordResetEmailPayload({
    to: "office@ostheimer.at",
    from: "Deepglot <noreply@deepglot.ai>",
    resetUrl: "https://deepglot.ai/reset-password?token=abc",
    locale: "de",
  });

  assert.equal(payload.to, "office@ostheimer.at");
  assert.equal(payload.from, "Deepglot <noreply@deepglot.ai>");
  assert.equal(payload.subject, "Passwort für Deepglot zurücksetzen");
  assert.match(payload.text, /60 Minuten gültig/);
  assert.match(payload.html, /Passwort zurücksetzen/);
  assert.match(payload.html, /https:\/\/deepglot\.ai\/reset-password\?token=abc/);
});

test("sends password reset email through Cloudflare REST API", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_EMAIL_API_TOKEN: process.env.CLOUDFLARE_EMAIL_API_TOKEN,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  process.env.CLOUDFLARE_ACCOUNT_ID = "account";
  process.env.CLOUDFLARE_EMAIL_API_TOKEN = "token";
  process.env.EMAIL_FROM = "Deepglot <noreply@deepglot.ai>";
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        success: true,
        errors: [],
        messages: [],
        result: { delivered: ["office@ostheimer.at"], permanent_bounces: [], queued: [] },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const result = await sendPasswordResetEmail({
    to: "office@ostheimer.at",
    resetUrl: "https://deepglot.ai/reset-password?token=abc",
    locale: "en",
  });

  assert.equal(result.sent, true);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://api.cloudflare.com/client/v4/accounts/account/email/sending/send"
  );
  assert.equal(requests[0].init?.method, "POST");
  assert.equal(
    (requests[0].init?.headers as Record<string, string>).Authorization,
    "Bearer token"
  );
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    from: "Deepglot <noreply@deepglot.ai>",
    to: "office@ostheimer.at",
    subject: "Reset your Deepglot password",
    text: "You requested to reset your Deepglot password.\n\nhttps://deepglot.ai/reset-password?token=abc\n\nThis link is valid for 60 minutes. If you did not request this, you can ignore this email.",
    html: "\n      <div style=\"font-family:Arial,sans-serif;line-height:1.5;color:#111827\">\n        <p>You requested to reset your Deepglot password.</p>\n        <p>\n          <a href=\"https://deepglot.ai/reset-password?token=abc\" style=\"display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700\">\n            Reset password\n          </a>\n        </p>\n        <p style=\"color:#4b5563\">This link is valid for 60 minutes. If you did not request this, you can ignore this email.</p>\n        <p style=\"word-break:break-all;color:#6b7280\">https://deepglot.ai/reset-password?token=abc</p>\n      </div>\n    ",
  });
});

test("billing alert recipient is gated on DEEPGLOT_BILLING_ALERT_EMAIL", () => {
  assert.equal(getBillingAlertRecipient({}), null);
  assert.equal(
    getBillingAlertRecipient({ DEEPGLOT_BILLING_ALERT_EMAIL: "   " }),
    null
  );
  assert.equal(
    getBillingAlertRecipient({
      DEEPGLOT_BILLING_ALERT_EMAIL: " ops@example.com ",
    }),
    "ops@example.com"
  );
});

test("builds the duplicate subscription alert email payload", () => {
  const payload = buildDuplicateSubscriptionAlertEmailPayload({
    to: "ops@example.com",
    from: "Deepglot <noreply@deepglot.ai>",
    organizationId: "org_123",
    keptSubscriptionId: "sub_kept",
    orphanedSubscriptionId: "sub_orphaned",
  });

  assert.equal(payload.to, "ops@example.com");
  assert.equal(payload.from, "Deepglot <noreply@deepglot.ai>");
  assert.match(payload.subject, /duplicate Stripe subscription/i);
  assert.match(payload.subject, /org_123/);
  assert.match(payload.text, /sub_kept/);
  assert.match(payload.text, /sub_orphaned/);
  assert.match(payload.text, /cancel and refund manually/);
  assert.match(payload.html, /dashboard\.stripe\.com\/subscriptions\/sub_orphaned/);
});

test("duplicate subscription alert is skipped without a recipient", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_EMAIL_API_TOKEN: process.env.CLOUDFLARE_EMAIL_API_TOKEN,
    EMAIL_FROM: process.env.EMAIL_FROM,
    DEEPGLOT_BILLING_ALERT_EMAIL: process.env.DEEPGLOT_BILLING_ALERT_EMAIL,
  };
  let fetchCalls = 0;

  process.env.CLOUDFLARE_ACCOUNT_ID = "account";
  process.env.CLOUDFLARE_EMAIL_API_TOKEN = "token";
  process.env.EMAIL_FROM = "Deepglot <noreply@deepglot.ai>";
  delete process.env.DEEPGLOT_BILLING_ALERT_EMAIL;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("{}", { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const result = await sendDuplicateSubscriptionAlertEmail({
    organizationId: "org_123",
    keptSubscriptionId: "sub_kept",
    orphanedSubscriptionId: "sub_orphaned",
  });

  assert.deepEqual(result, { sent: false, reason: "email_not_configured" });
  assert.equal(fetchCalls, 0);
});

test("sends duplicate subscription alert through Cloudflare REST API", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_EMAIL_API_TOKEN: process.env.CLOUDFLARE_EMAIL_API_TOKEN,
    EMAIL_FROM: process.env.EMAIL_FROM,
    DEEPGLOT_BILLING_ALERT_EMAIL: process.env.DEEPGLOT_BILLING_ALERT_EMAIL,
  };
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  process.env.CLOUDFLARE_ACCOUNT_ID = "account";
  process.env.CLOUDFLARE_EMAIL_API_TOKEN = "token";
  process.env.EMAIL_FROM = "Deepglot <noreply@deepglot.ai>";
  process.env.DEEPGLOT_BILLING_ALERT_EMAIL = "ops@example.com";
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        success: true,
        errors: [],
        messages: [],
        result: { delivered: ["ops@example.com"], permanent_bounces: [], queued: [] },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const result = await sendDuplicateSubscriptionAlertEmail({
    organizationId: "org_123",
    keptSubscriptionId: "sub_kept",
    orphanedSubscriptionId: "sub_orphaned",
    signal: AbortSignal.timeout(5000),
  });

  assert.equal(result.sent, true);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://api.cloudflare.com/client/v4/accounts/account/email/sending/send"
  );
  // The abort signal must reach fetch so a stalled provider cannot block the
  // Stripe webhook past the timeout.
  assert.ok(requests[0].init?.signal instanceof AbortSignal);
  const body = JSON.parse(String(requests[0].init?.body)) as {
    to: string;
    subject: string;
    text: string;
  };
  assert.equal(body.to, "ops@example.com");
  assert.match(body.subject, /org_123/);
  assert.match(body.text, /sub_orphaned/);
});

test("builds localized project invitation email payloads", () => {
  const payload = buildProjectInvitationEmailPayload({
    to: "translator@example.com",
    from: "Deepglot <noreply@deepglot.ai>",
    inviteUrl: "https://deepglot.ai/de/accept-invite?token=abc",
    locale: "de",
    projectName: "meinhaushalt.at",
    inviterName: "Admin User",
  });

  assert.equal(payload.to, "translator@example.com");
  assert.equal(payload.subject, "Einladung zu einem Deepglot-Projekt");
  assert.match(payload.text, /Projekt: meinhaushalt\.at/);
  assert.match(payload.text, /Eingeladen von: Admin User/);
  assert.match(payload.text, /7 Tage gültig/);
  assert.match(payload.html, /Einladung annehmen/);
});

test("sends project invitation email through Cloudflare REST API", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_EMAIL_API_TOKEN: process.env.CLOUDFLARE_EMAIL_API_TOKEN,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  process.env.CLOUDFLARE_ACCOUNT_ID = "account";
  process.env.CLOUDFLARE_EMAIL_API_TOKEN = "token";
  process.env.EMAIL_FROM = "Deepglot <noreply@deepglot.ai>";
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        success: true,
        errors: [],
        messages: [],
        result: { delivered: ["translator@example.com"], permanent_bounces: [], queued: [] },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const result = await sendProjectInvitationEmail({
    to: "translator@example.com",
    inviteUrl: "https://deepglot.ai/accept-invite?token=abc",
    locale: "en",
    projectName: "meinhaushalt.at",
    inviterName: "Admin User",
  });

  assert.equal(result.sent, true);
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    from: "Deepglot <noreply@deepglot.ai>",
    to: "translator@example.com",
    subject: "Invitation to a Deepglot project",
    text: "You have been invited to collaborate on a Deepglot project.\n\nProject: meinhaushalt.at\n\nInvited by: Admin User\n\nhttps://deepglot.ai/accept-invite?token=abc\n\nThis link is valid for 7 days. If you did not expect this invitation, you can ignore this email.",
    html: "\n      <div style=\"font-family:Arial,sans-serif;line-height:1.5;color:#111827\">\n        <p>You have been invited to collaborate on a Deepglot project.</p>\n        <p style=\"color:#374151\">Project: meinhaushalt.at<br>Invited by: Admin User</p>\n        <p>\n          <a href=\"https://deepglot.ai/accept-invite?token=abc\" style=\"display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700\">\n            Accept invitation\n          </a>\n        </p>\n        <p style=\"color:#4b5563\">This link is valid for 7 days. If you did not expect this invitation, you can ignore this email.</p>\n        <p style=\"word-break:break-all;color:#6b7280\">https://deepglot.ai/accept-invite?token=abc</p>\n      </div>\n    ",
  });
});
