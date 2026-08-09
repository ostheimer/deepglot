import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";
import type { ActivityDigestSummary } from "@/lib/activity-digest";
import { getIntlLocale } from "@/lib/locale-formatting";
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
          <a href="${resetUrl}" style="display:inline-block;background:#df351c;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700">
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
          <a href="${inviteUrl}" style="display:inline-block;background:#df351c;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700">
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

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatActivityDigestPeriod(
  summary: ActivityDigestSummary,
  locale: SiteLocale
) {
  const formatter = new Intl.DateTimeFormat(getIntlLocale(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const inclusiveEnd = new Date(summary.period.end.getTime() - 1);

  return `${formatter.format(summary.period.start)}–${formatter.format(inclusiveEnd)}`;
}

function activityDigestMetricCopy({
  locale,
  summary,
}: {
  locale: SiteLocale;
  summary: ActivityDigestSummary;
}) {
  const de = locale === "de";
  const numbers = new Intl.NumberFormat(getIntlLocale(locale));
  const newTranslations = numbers.format(summary.totals.newTranslations);
  const newWords = numbers.format(summary.totals.newWords);
  const manualTranslations = numbers.format(summary.totals.manualTranslations);
  const manualWords = numbers.format(summary.totals.manualWords);
  const translationRequests = numbers.format(summary.totals.translationRequests);

  return {
    newTranslations: de
      ? `${newTranslations} ${summary.totals.newTranslations === 1 ? "neue Übersetzung" : "neue Übersetzungen"}`
      : `${newTranslations} new ${summary.totals.newTranslations === 1 ? "translation" : "translations"}`,
    newWords: de
      ? `${newWords} ${summary.totals.newWords === 1 ? "Wort" : "Wörter"}`
      : `${newWords} ${summary.totals.newWords === 1 ? "word" : "words"}`,
    manualTranslations: de
      ? `${manualTranslations} ${summary.totals.manualTranslations === 1 ? "manuelle Bearbeitung" : "manuelle Bearbeitungen"}`
      : `${manualTranslations} manual ${summary.totals.manualTranslations === 1 ? "edit" : "edits"}`,
    manualWords: de
      ? `${manualWords} ${summary.totals.manualWords === 1 ? "Wort" : "Wörter"}`
      : `${manualWords} ${summary.totals.manualWords === 1 ? "word" : "words"}`,
    translationRequests: de
      ? `${translationRequests} ${summary.totals.translationRequests === 1 ? "Übersetzungsanfrage" : "Übersetzungsanfragen"}`
      : `${translationRequests} translation ${summary.totals.translationRequests === 1 ? "request" : "requests"}`,
  };
}

export function buildActivityDigestEmailPayload({
  to,
  from,
  locale,
  summary,
  dashboardUrl,
  settingsUrl,
}: {
  to: string;
  from: string;
  locale: SiteLocale;
  summary: ActivityDigestSummary;
  dashboardUrl: string;
  settingsUrl: string;
}) {
  const de = locale === "de";
  const numbers = new Intl.NumberFormat(getIntlLocale(locale));
  const period = formatActivityDigestPeriod(summary, locale);
  const metrics = activityDigestMetricCopy({ locale, summary });
  const subject = de
    ? `Dein Deepglot-Wochenrückblick – ${summary.organizationName}`
    : `Your Deepglot weekly digest – ${summary.organizationName}`;
  const projectLines = summary.projects.map((project) => {
    const name = project.domain || project.name;
    return de
      ? `${name}: ${numbers.format(project.newTranslations)} neue Übersetzungen, ${numbers.format(project.manualTranslations)} manuelle Bearbeitungen, ${numbers.format(project.translationRequests)} Übersetzungsanfragen`
      : `${name}: ${numbers.format(project.newTranslations)} new translations, ${numbers.format(project.manualTranslations)} manual edits, ${numbers.format(project.translationRequests)} translation requests`;
  });
  const text = [
    de
      ? "Hier ist dein Deepglot-Wochenrückblick."
      : "Here is your Deepglot weekly activity digest.",
    `${de ? "Workspace" : "Workspace"}: ${summary.organizationName}`,
    `${de ? "Zeitraum" : "Period"}: ${period}`,
    `${metrics.newTranslations} (${metrics.newWords})`,
    `${metrics.manualTranslations} (${metrics.manualWords})`,
    metrics.translationRequests,
    ...projectLines,
    `${de ? "Aktivität öffnen" : "Open activity"}: ${dashboardUrl}`,
    `${de ? "E-Mail-Einstellungen" : "Email settings"}: ${settingsUrl}`,
  ].join("\n\n");
  const htmlOrganizationName = escapeHtmlText(summary.organizationName);
  const htmlDashboardUrl = escapeHtmlText(dashboardUrl);
  const htmlSettingsUrl = escapeHtmlText(settingsUrl);
  const htmlProjects = summary.projects
    .map(
      (project) => `
        <tr>
          <td style="padding:12px 0;border-top:1px solid #e5e7eb">
            <strong style="color:#111827">${escapeHtmlText(project.domain || project.name)}</strong>
            ${project.domain && project.name !== project.domain ? `<div style="color:#6b7280;font-size:12px">${escapeHtmlText(project.name)}</div>` : ""}
            <div style="margin-top:4px;color:#4b5563;font-size:13px">
              ${numbers.format(project.newTranslations)} ${de ? "neue Übersetzungen" : "new translations"}
              &nbsp;&middot;&nbsp; ${numbers.format(project.manualTranslations)} ${de ? "manuelle Bearbeitungen" : "manual edits"}
              &nbsp;&middot;&nbsp; ${numbers.format(project.translationRequests)} ${de ? "Übersetzungsanfragen" : "translation requests"}
            </div>
          </td>
        </tr>
      `
    )
    .join("");

  return {
    from,
    to,
    subject,
    text,
    html: `
      <div style="margin:0;background:#f5f6f8;padding:32px 16px;font-family:Arial,sans-serif;line-height:1.5;color:#111827">
        <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
          <div style="padding:24px 28px;background:#df351c;color:#ffffff">
            <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Deepglot</div>
            <h1 style="margin:8px 0 0;font-size:26px;line-height:1.2">${de ? "Wochenrückblick" : "Weekly activity digest"}</h1>
          </div>
          <div style="padding:28px">
            <p style="margin:0;color:#4b5563">${de ? "Hier ist deine Aktivität der letzten vollständigen Woche." : "Here is your activity from the last complete week."}</p>
            <h2 style="margin:20px 0 2px;font-size:24px">${htmlOrganizationName}</h2>
            <p style="margin:0;color:#6b7280">${escapeHtmlText(period)}</p>

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;border-collapse:separate;border-spacing:8px 0;table-layout:fixed">
              <tr>
                <td width="33.33%" valign="top">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed">
                    <tr>
                      <td style="padding:16px 4px;background:#fff4f1;border-radius:12px;text-align:center">
                        <div style="font-size:28px;font-weight:800;color:#df351c">${numbers.format(summary.totals.newTranslations)}</div>
                        <div style="font-size:13px;font-weight:700">${de ? "Neue Übersetzungen" : "New translations"}</div>
                        <div style="font-size:12px;color:#6b7280">${metrics.newWords}</div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="33.33%" valign="top">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed">
                    <tr>
                      <td style="padding:16px 4px;background:#fff4f1;border-radius:12px;text-align:center">
                        <div style="font-size:28px;font-weight:800;color:#df351c">${numbers.format(summary.totals.manualTranslations)}</div>
                        <div style="font-size:13px;font-weight:700">${de ? "Manuell bearbeitet" : "Manual edits"}</div>
                        <div style="font-size:12px;color:#6b7280">${metrics.manualWords}</div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="33.33%" valign="top">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed">
                    <tr>
                      <td style="padding:16px 4px;background:#fff4f1;border-radius:12px;text-align:center">
                        <div style="font-size:28px;font-weight:800;color:#df351c">${numbers.format(summary.totals.translationRequests)}</div>
                        <div style="font-size:13px;font-weight:700">${de ? "Übersetzungs-<br>Anfragen" : "Translation<br>requests"}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;border-collapse:collapse">
              ${htmlProjects}
            </table>

            <p style="margin:28px 0 0">
              <a href="${htmlDashboardUrl}" style="display:inline-block;background:#df351c;color:#ffffff;text-decoration:none;padding:11px 16px;border-radius:8px;font-weight:700">
                ${de ? "Aktivität öffnen" : "Open activity"}
              </a>
            </p>
            <p style="margin:24px 0 0;color:#6b7280;font-size:12px">
              ${de ? "Du erhältst diese E-Mail, weil der Wochenrückblick für diesen Workspace aktiviert ist." : "You receive this email because the weekly digest is enabled for this workspace."}
              <a href="${htmlSettingsUrl}" style="color:#6b7280">${de ? "Einstellungen ändern" : "Change settings"}</a>
            </p>
          </div>
        </div>
      </div>
    `,
  };
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
          <a href="${stripeUrl}" style="display:inline-block;background:#df351c;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700">
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

/**
 * Owner-facing monthly word-quota warning (#148). Bilingual (EN + DE) because
 * the org owner's UI locale is not reliably known at send time. `threshold` is
 * the percent that was crossed (e.g. 90 or 100); at 100 the wording switches
 * from "approaching" to "reached".
 */
export function buildQuotaAlertEmailPayload({
  to,
  from,
  organizationName,
  threshold,
  wordsUsed,
  wordsLimit,
  dashboardUrl,
}: {
  to: string;
  from: string;
  organizationName: string;
  threshold: number;
  wordsUsed: number;
  wordsLimit: number;
  dashboardUrl: string;
}) {
  const reached = threshold >= 100;
  const usedLabel = wordsUsed.toLocaleString("en-US");
  const limitLabel = wordsLimit.toLocaleString("en-US");

  const subject = reached
    ? `Deepglot: monthly word limit reached — ${organizationName}`
    : `Deepglot: ${threshold}% of your monthly word limit used — ${organizationName}`;

  const enLead = reached
    ? "Your Deepglot organization has reached its monthly word limit. Already-translated content keeps serving, but new or changed text stays in the source language until the quota resets or you upgrade."
    : `Your Deepglot organization has used ${threshold}% of its monthly word limit. Once it is reached, new or changed content stays in the source language until the quota resets or you upgrade.`;
  const deLead = reached
    ? "Deine Deepglot-Organisation hat das monatliche Wortlimit erreicht. Bereits übersetzte Inhalte werden weiter ausgeliefert, aber neue oder geänderte Texte bleiben in der Ausgangssprache, bis das Kontingent zurückgesetzt oder erhöht wird."
    : `Deine Deepglot-Organisation hat ${threshold}% des monatlichen Wortlimits verbraucht. Sobald es erreicht ist, bleiben neue oder geänderte Inhalte in der Ausgangssprache, bis das Kontingent zurückgesetzt oder erhöht wird.`;

  const usageLine = `${organizationName}: ${usedLabel} / ${limitLabel} words (${threshold}%)`;
  const htmlUsageLine = escapeHtmlText(usageLine);

  const text = [
    enLead,
    deLead,
    usageLine,
    `Usage: ${dashboardUrl}`,
  ].join("\n\n");

  return {
    from,
    to,
    subject,
    text,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
        <p>${enLead}</p>
        <p style="color:#374151">${deLead}</p>
        <p style="color:#374151"><strong>${htmlUsageLine}</strong></p>
        <p>
          <a href="${dashboardUrl}" style="display:inline-block;background:#df351c;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700">
            Open usage / Nutzung öffnen
          </a>
        </p>
      </div>
    `,
  };
}

/**
 * Sends the owner-facing quota warning. Returns `{ sent: false }` when the
 * Cloudflare email config is missing; throws on API errors (callers must catch
 * — a failed alert must never fail the translation request that triggered it).
 */
export async function sendQuotaAlertEmail({
  to,
  organizationName,
  threshold,
  wordsUsed,
  wordsLimit,
  dashboardUrl,
  signal,
}: {
  to: string;
  organizationName: string;
  threshold: number;
  wordsUsed: number;
  wordsLimit: number;
  dashboardUrl: string;
  /** Bounds the send so a stalled email provider cannot delay the response. */
  signal?: AbortSignal;
}) {
  const config = getCloudflareEmailConfig();

  if (!config) {
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
      buildQuotaAlertEmailPayload({
        to,
        from: config.from,
        organizationName,
        threshold,
        wordsUsed,
        wordsLimit,
        dashboardUrl,
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

export async function sendActivityDigestEmail({
  to,
  locale,
  summary,
  dashboardUrl,
  settingsUrl,
  signal,
}: {
  to: string;
  locale: SiteLocale;
  summary: ActivityDigestSummary;
  dashboardUrl: string;
  settingsUrl: string;
  signal?: AbortSignal;
}) {
  const config = getCloudflareEmailConfig();

  if (!config) {
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
      buildActivityDigestEmailPayload({
        to,
        from: config.from,
        locale,
        summary,
        dashboardUrl,
        settingsUrl,
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

  return {
    sent: true as const,
    provider: "cloudflare" as const,
    result: data.result,
  };
}
