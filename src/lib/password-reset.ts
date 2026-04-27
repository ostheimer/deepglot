import crypto from "crypto";

import { withLocalePrefix, type SiteLocale } from "@/lib/site-locale";

export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
export const PASSWORD_RESET_IDENTIFIER_PREFIX = "password-reset:";

function normalizeBaseUrl(value: string | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  return value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`;
}

function getVercelDeploymentBaseUrl(env: Record<string, string | undefined>) {
  if (!env.VERCEL) {
    return null;
  }

  const deploymentHost =
    env.VERCEL_ENV === "production"
      ? env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_BRANCH_URL ?? env.VERCEL_URL
      : env.VERCEL_BRANCH_URL ?? env.VERCEL_URL ?? env.VERCEL_PROJECT_PRODUCTION_URL;

  return normalizeBaseUrl(deploymentHost);
}

export function normalizePasswordResetEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getPasswordResetIdentifier(email: string) {
  return `${PASSWORD_RESET_IDENTIFIER_PREFIX}${normalizePasswordResetEmail(email)}`;
}

export function createPasswordResetToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashPasswordResetToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getPasswordResetExpiresAt(now = new Date()) {
  return new Date(now.getTime() + PASSWORD_RESET_TTL_SECONDS * 1000);
}

export function getPasswordResetBaseUrl(
  env: Record<string, string | undefined> = process.env
) {
  const baseUrl =
    normalizeBaseUrl(env.AUTH_URL) ??
    normalizeBaseUrl(env.NEXT_PUBLIC_APP_URL) ??
    getVercelDeploymentBaseUrl(env);

  if (!baseUrl) {
    throw new Error(
      "Missing AUTH_URL, NEXT_PUBLIC_APP_URL, or Vercel system URL for password reset links."
    );
  }

  return baseUrl;
}

export function buildPasswordResetUrl({
  token,
  locale,
  baseUrl = getPasswordResetBaseUrl(),
}: {
  token: string;
  locale: SiteLocale;
  baseUrl?: string;
}) {
  const url = new URL(withLocalePrefix("/reset-password", locale), baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function canSendPasswordResetEmail(
  env: Record<string, string | undefined> = process.env
) {
  return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}
