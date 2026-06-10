import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";
const CLOUDFLARE_EMAIL_API_BASE_URL =
  "https://api.cloudflare.com/client/v4/accounts";

export type CloudflareEmailConfig = {
  accountId: string;
  apiToken: string;
  from: string;
};

type CloudflareEmailResponse = {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  messages?: unknown[];
  result?: {
    delivered?: string[];
    permanent_bounces?: string[];
    queued?: string[];
  } | null;
};

export function getCloudflareEmailConfig(
  env: Record<string, string | undefined> = process.env
): CloudflareEmailConfig | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();
  const from = env.EMAIL_FROM?.trim();

  if (!accountId || !apiToken || !from) {
    return null;
  }

  return { accountId, apiToken, from };
}

export function canSendEmail(env: Record<string, string | undefined> = process.env) {
  return Boolean(getCloudflareEmailConfig(env));
}

export function buildCloudflareEmailApiUrl(accountId: string) {
  return `${CLOUDFLARE_EMAIL_API_BASE_URL}/${encodeURIComponent(accountId)}/email/sending/send`;
}

function getPasswordResetEmailCopy(locale: SiteLocale) {
  const subject =
    uiText(locale, "Reset your Deepglot password", "Passwort für Deepglot zurücksetzen");
  const intro =
    uiText(locale, "You requested to reset your Deepglot password.", "Du hast angefordert, dein Deepglot-Passwort zurückzusetzen.");
  const action = uiText(locale, "Reset password", "Passwort zurücksetzen");
  const expiry =
    uiText(locale, "This link is valid for 60 minutes. If you did not request this, you can ignore this email.", "Der Link ist 60 Minuten gültig. Wenn du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.");

  return { subject, intro, action, expiry };
}

function getProjectInvitationEmailCopy(locale: SiteLocale) {
  const subject =
    uiText(locale, "Invitation to a Deepglot project", "Einladung zu einem Deepglot-Projekt");
  const intro =
    uiText(locale, "You have been invited to collaborate on a Deepglot project.", "Du wurdest eingeladen, an einem Deepglot-Projekt mitzuarbeiten.");
  const action = uiText(locale, "Accept invitation", "Einladung annehmen");
  const expiry =
    uiText(locale, "This link is valid for 7 days. If you did not expect this invitation, you can ignore this email.", "Der Link ist 7 Tage gültig. Wenn du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.");

  return { subject, intro, action, expiry };
}

export function buildPasswordResetEmailPayload({
  to,
  from,
  resetUrl,
  locale,
}: {
  to: string;
  from: string;
  resetUrl: string;
  locale: SiteLocale;
}) {
  const copy = getPasswordResetEmailCopy(locale);

  return {
    from,
    to,
    subject: copy.subject,
    text: `${copy.intro}\n\n${resetUrl}\n\n${copy.expiry}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
        <p>${copy.intro}</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700">
            ${copy.action}
          </a>
        </p>
        <p style="color:#4b5563">${copy.expiry}</p>
        <p style="word-break:break-all;color:#6b7280">${resetUrl}</p>
      </div>
    `,
  };
}

export function buildProjectInvitationEmailPayload({
  to,
  from,
  inviteUrl,
  locale,
  projectName,
  inviterName,
}: {
  to: string;
  from: string;
  inviteUrl: string;
  locale: SiteLocale;
  projectName: string;
  inviterName?: string | null;
}) {
  const copy = getProjectInvitationEmailCopy(locale);
  const projectLine = uiText(locale, "Project: {project}", "Projekt: {project}").replace(
    "{project}",
    projectName
  );
  const inviterLine = inviterName
    ? uiText(locale, "Invited by: {name}", "Eingeladen von: {name}").replace(
        "{name}",
        inviterName
      )
    : null;

  return {
    from,
    to,
    subject: copy.subject,
    text: [
      copy.intro,
      projectLine,
      inviterLine,
      inviteUrl,
      copy.expiry,
    ].filter(Boolean).join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
        <p>${copy.intro}</p>
        <p style="color:#374151">${projectLine}${inviterLine ? `<br>${inviterLine}` : ""}</p>
        <p>
          <a href="${inviteUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700">
            ${copy.action}
          </a>
        </p>
        <p style="color:#4b5563">${copy.expiry}</p>
        <p style="word-break:break-all;color:#6b7280">${inviteUrl}</p>
      </div>
    `,
  };
}

function formatCloudflareEmailError(response: CloudflareEmailResponse) {
  const message = response.errors
    ?.map((error) => error.message)
    .filter(Boolean)
    .join("; ");

  return message || "Unknown Cloudflare Email Sending error";
}

export async function sendPasswordResetEmail({
  to,
  resetUrl,
  locale,
}: {
  to: string;
  resetUrl: string;
  locale: SiteLocale;
}) {
  const config = getCloudflareEmailConfig();

  if (!config) {
    return { sent: false, reason: "email_not_configured" as const };
  }

  const response = await fetch(buildCloudflareEmailApiUrl(config.accountId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildPasswordResetEmailPayload({
        to,
        from: config.from,
        resetUrl,
        locale,
      })
    ),
  });
  const data = (await response.json().catch(() => null)) as
    | CloudflareEmailResponse
    | null;

  if (!response.ok || !data?.success) {
    throw new Error(
      `Cloudflare Email Sending failed: ${
        data ? formatCloudflareEmailError(data) : response.statusText
      }`
    );
  }

  return { sent: true as const, provider: "cloudflare" as const, result: data.result };
}

/**
 * Recipient for operational billing alerts (duplicate Stripe subscription
 * detected by the checkout webhook). Unset/empty disables the alert email;
 * the webhook then only logs.
 */
export function getBillingAlertRecipient(
  env: Record<string, string | undefined> = process.env
): string | null {
  const recipient = env.DEEPGLOT_BILLING_ALERT_EMAIL?.trim();

  return recipient || null;
}

export function buildDuplicateSubscriptionAlertEmailPayload({
  to,
  from,
  organizationId,
  keptSubscriptionId,
  orphanedSubscriptionId,
}: {
  to: string;
  from: string;
  organizationId: string;
  keptSubscriptionId: string;
  orphanedSubscriptionId: string;
}) {
  const subject = `Deepglot alert: duplicate Stripe subscription (org ${organizationId})`;
  const stripeUrl = `https://dashboard.stripe.com/subscriptions/${orphanedSubscriptionId}`;
  const lines = [
    "A completed Stripe Checkout created a duplicate paid subscription. The app keeps the first subscription; the new one is billing the customer but is not tracked.",
    `Organization: ${organizationId}`,
    `Kept (tracked) subscription: ${keptSubscriptionId}`,
    `Orphaned subscription — cancel and refund manually: ${orphanedSubscriptionId}`,
    `Stripe: ${stripeUrl}`,
    'Runbook: OPERATIONS.md → "Duplicate Subscription Alert (Stripe)"',
  ];

  return {
    from,
    to,
    subject,
    text: lines.join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
        <p>${lines[0]}</p>
        <p style="color:#374151">
          Organization: <strong>${organizationId}</strong><br>
          Kept (tracked) subscription: <strong>${keptSubscriptionId}</strong><br>
          Orphaned subscription — cancel and refund manually: <strong>${orphanedSubscriptionId}</strong>
        </p>
        <p>
          <a href="${stripeUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700">
            Open in Stripe
          </a>
        </p>
        <p style="color:#4b5563">Runbook: OPERATIONS.md &rarr; &quot;Duplicate Subscription Alert (Stripe)&quot;</p>
      </div>
    `,
  };
}

/**
 * Sends the duplicate-subscription operations alert. Returns
 * `{ sent: false }` when either the Cloudflare email config or the
 * `DEEPGLOT_BILLING_ALERT_EMAIL` recipient is missing; throws on API errors
 * (callers must catch — a failed alert must never fail the webhook).
 */
export async function sendDuplicateSubscriptionAlertEmail({
  organizationId,
  keptSubscriptionId,
  orphanedSubscriptionId,
  signal,
}: {
  organizationId: string;
  keptSubscriptionId: string;
  orphanedSubscriptionId: string;
  /**
   * Bounds the send so a stalled email provider cannot delay acknowledging
   * the Stripe webhook (which would trigger event retries).
   */
  signal?: AbortSignal;
}) {
  const config = getCloudflareEmailConfig();
  const to = getBillingAlertRecipient();

  if (!config || !to) {
    return { sent: false, reason: "email_not_configured" as const };
  }

  const response = await fetch(buildCloudflareEmailApiUrl(config.accountId), {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildDuplicateSubscriptionAlertEmailPayload({
        to,
        from: config.from,
        organizationId,
        keptSubscriptionId,
        orphanedSubscriptionId,
      })
    ),
  });
  const data = (await response.json().catch(() => null)) as
    | CloudflareEmailResponse
    | null;

  if (!response.ok || !data?.success) {
    throw new Error(
      `Cloudflare Email Sending failed: ${
        data ? formatCloudflareEmailError(data) : response.statusText
      }`
    );
  }

  return { sent: true as const, provider: "cloudflare" as const, result: data.result };
}

export async function sendProjectInvitationEmail({
  to,
  inviteUrl,
  locale,
  projectName,
  inviterName,
}: {
  to: string;
  inviteUrl: string;
  locale: SiteLocale;
  projectName: string;
  inviterName?: string | null;
}) {
  const config = getCloudflareEmailConfig();

  if (!config) {
    return { sent: false, reason: "email_not_configured" as const };
  }

  const response = await fetch(buildCloudflareEmailApiUrl(config.accountId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildProjectInvitationEmailPayload({
        to,
        from: config.from,
        inviteUrl,
        locale,
        projectName,
        inviterName,
      })
    ),
  });
  const data = (await response.json().catch(() => null)) as
    | CloudflareEmailResponse
    | null;

  if (!response.ok || !data?.success) {
    throw new Error(
      `Cloudflare Email Sending failed: ${
        data ? formatCloudflareEmailError(data) : response.statusText
      }`
    );
  }

  return { sent: true as const, provider: "cloudflare" as const, result: data.result };
}
