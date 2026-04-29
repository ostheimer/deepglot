const CLOUDFLARE_EMAIL_API_BASE_URL =
  "https://api.cloudflare.com/client/v4/accounts";

type EmailLocale = "en" | "de";

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

function getPasswordResetEmailCopy(locale: EmailLocale) {
  const subject =
    locale === "de"
      ? "Passwort für Deepglot zurücksetzen"
      : "Reset your Deepglot password";
  const intro =
    locale === "de"
      ? "Du hast angefordert, dein Deepglot-Passwort zurückzusetzen."
      : "You requested to reset your Deepglot password.";
  const action = locale === "de" ? "Passwort zurücksetzen" : "Reset password";
  const expiry =
    locale === "de"
      ? "Der Link ist 60 Minuten gültig. Wenn du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren."
      : "This link is valid for 60 minutes. If you did not request this, you can ignore this email.";

  return { subject, intro, action, expiry };
}

function getProjectInvitationEmailCopy(locale: EmailLocale) {
  const subject =
    locale === "de"
      ? "Einladung zu einem Deepglot-Projekt"
      : "Invitation to a Deepglot project";
  const intro =
    locale === "de"
      ? "Du wurdest eingeladen, an einem Deepglot-Projekt mitzuarbeiten."
      : "You have been invited to collaborate on a Deepglot project.";
  const action = locale === "de" ? "Einladung annehmen" : "Accept invitation";
  const expiry =
    locale === "de"
      ? "Der Link ist 7 Tage gültig. Wenn du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren."
      : "This link is valid for 7 days. If you did not expect this invitation, you can ignore this email.";

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
  locale: EmailLocale;
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
  locale: EmailLocale;
  projectName: string;
  inviterName?: string | null;
}) {
  const copy = getProjectInvitationEmailCopy(locale);
  const projectLine =
    locale === "de"
      ? `Projekt: ${projectName}`
      : `Project: ${projectName}`;
  const inviterLine = inviterName
    ? locale === "de"
      ? `Eingeladen von: ${inviterName}`
      : `Invited by: ${inviterName}`
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
  locale: EmailLocale;
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

export async function sendProjectInvitationEmail({
  to,
  inviteUrl,
  locale,
  projectName,
  inviterName,
}: {
  to: string;
  inviteUrl: string;
  locale: EmailLocale;
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
