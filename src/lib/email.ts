import { Resend } from "resend";

let resendClient: Resend | null = null;

function getResendClient() {
  if (!process.env.RESEND_API_KEY?.trim()) {
    return null;
  }

  resendClient ??= new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

export async function sendPasswordResetEmail({
  to,
  resetUrl,
  locale,
}: {
  to: string;
  resetUrl: string;
  locale: "en" | "de";
}) {
  const client = getResendClient();
  const from = process.env.EMAIL_FROM?.trim();

  if (!client || !from) {
    return { sent: false, reason: "email_not_configured" as const };
  }

  const subject =
    locale === "de"
      ? "Passwort für Deepglot zurücksetzen"
      : "Reset your Deepglot password";
  const intro =
    locale === "de"
      ? "Du hast angefordert, dein Deepglot-Passwort zurückzusetzen."
      : "You requested to reset your Deepglot password.";
  const action =
    locale === "de"
      ? "Passwort zurücksetzen"
      : "Reset password";
  const expiry =
    locale === "de"
      ? "Der Link ist 60 Minuten gültig. Wenn du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren."
      : "This link is valid for 60 minutes. If you did not request this, you can ignore this email.";

  await client.emails.send({
    from,
    to,
    subject,
    text: `${intro}\n\n${resetUrl}\n\n${expiry}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
        <p>${intro}</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700">
            ${action}
          </a>
        </p>
        <p style="color:#4b5563">${expiry}</p>
        <p style="word-break:break-all;color:#6b7280">${resetUrl}</p>
      </div>
    `,
  });

  return { sent: true as const };
}
