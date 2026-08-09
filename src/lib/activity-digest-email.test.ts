import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActivityDigestEmailPayload,
  sendActivityDigestEmail,
} from "@/lib/email";

const summary = {
  organizationName: "Medizin & <Pflege>",
  period: {
    start: new Date("2026-07-27T00:00:00.000Z"),
    end: new Date("2026-08-03T00:00:00.000Z"),
  },
  totals: {
    newTranslations: 198,
    newWords: 2434,
    manualTranslations: 2,
    manualWords: 14,
    translationRequests: 2147,
  },
  projects: [
    {
      id: "project-1",
      name: "Jugend & <Med>",
      domain: "juvenismed.at",
      newTranslations: 198,
      newWords: 2434,
      manualTranslations: 2,
      manualWords: 14,
      translationRequests: 2147,
    },
  ],
};

test("builds a localized German weekly activity digest", () => {
  const payload = buildActivityDigestEmailPayload({
    to: "owner@example.com",
    from: "Deepglot <noreply@deepglot.ai>",
    locale: "de",
    summary,
    dashboardUrl: "https://deepglot.ai/de/projects",
    settingsUrl: "https://deepglot.ai/de/settings",
  });

  assert.equal(payload.subject, "Dein Deepglot-Wochenrückblick – Medizin & <Pflege>");
  assert.match(payload.text, /27\. Juli 2026–2\. August 2026/);
  assert.match(payload.text, /198 neue Übersetzungen/);
  assert.match(payload.text, /2\.434 Wörter/);
  assert.match(payload.text, /2 manuelle Bearbeitungen/);
  assert.match(payload.text, /2\.147 Übersetzungsanfragen/);
  assert.match(payload.html, /Medizin &amp; &lt;Pflege&gt;/);
  assert.match(payload.html, /Jugend &amp; &lt;Med&gt;/);
  assert.doesNotMatch(payload.html, /Jugend & <Med>/);
  assert.match(payload.html, /https:\/\/deepglot\.ai\/de\/settings/);
});

test("keeps the digest metric cards within narrow Outlook reading panes", () => {
  const payload = buildActivityDigestEmailPayload({
    to: "owner@example.com",
    from: "Deepglot <noreply@deepglot.ai>",
    locale: "de",
    summary,
    dashboardUrl: "https://deepglot.ai/de/projects",
    settingsUrl: "https://deepglot.ai/de/settings",
  });

  // Percentage-width table cells already consume the full row. Adding the
  // card padding directly to those cells makes the row wider than 100%, which
  // clips the third card in Outlook's narrow reading pane.
  assert.match(
    payload.html,
    /<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="[^"]*table-layout:fixed[^"]*"/
  );
  assert.doesNotMatch(
    payload.html,
    /<td width="33\.33%"[^>]*style="[^"]*padding:16px/
  );

  // Auto-layout nested tables still expand to their longest word plus 32px
  // horizontal padding (126px in a measured 99px Outlook-sized column),
  // visually merging cards and overflowing the final column.
  assert.equal(
    (
      payload.html.match(
        /<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed">/g
      ) ?? []
    ).length,
    3
  );
  assert.equal(
    (
      payload.html.match(
        /<td style="padding:16px 4px;background:#fff4f1;border-radius:12px;text-align:center">/g
      ) ?? []
    ).length,
    3
  );
});

test("hard-wraps the long German request label for Outlook", () => {
  const payload = buildActivityDigestEmailPayload({
    to: "owner@example.com",
    from: "Deepglot <noreply@deepglot.ai>",
    locale: "de",
    summary,
    dashboardUrl: "https://deepglot.ai/de/projects",
    settingsUrl: "https://deepglot.ai/de/settings",
  });

  // Outlook for Mac does not reliably wrap the German compound noun inside
  // the one-third-width card, so CSS-only wrapping still clips the label.
  assert.match(
    payload.html,
    />Übersetzungs-<br\s*\/?\s*>Anfragen<\/div>/
  );
  assert.doesNotMatch(payload.html, />Übersetzungsanfragen<\/div>/);
});

test("builds an English digest with an exclusive period end rendered inclusively", () => {
  const payload = buildActivityDigestEmailPayload({
    to: "owner@example.com",
    from: "Deepglot <noreply@deepglot.ai>",
    locale: "en",
    summary,
    dashboardUrl: "https://deepglot.ai/projects",
    settingsUrl: "https://deepglot.ai/settings",
  });

  assert.equal(payload.subject, "Your Deepglot weekly digest – Medizin & <Pflege>");
  assert.match(payload.text, /July 27, 2026–August 2, 2026/);
  assert.match(payload.text, /2,147 translation requests/);
});

test("sends the activity digest through the existing Cloudflare email provider", async (t) => {
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
        result: {
          delivered: ["owner@example.com"],
          permanent_bounces: [],
          queued: [],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const result = await sendActivityDigestEmail({
    to: "owner@example.com",
    locale: "de",
    summary,
    dashboardUrl: "https://deepglot.ai/de/projects",
    settingsUrl: "https://deepglot.ai/de/settings",
    signal: AbortSignal.timeout(5_000),
  });

  assert.equal(result.sent, true);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://api.cloudflare.com/client/v4/accounts/account/email/sending/send"
  );
  assert.ok(requests[0].init?.signal instanceof AbortSignal);
  const body = JSON.parse(String(requests[0].init?.body)) as {
    to: string;
    subject: string;
  };
  assert.equal(body.to, "owner@example.com");
  assert.match(body.subject, /Deepglot-Wochenrückblick/);
});
