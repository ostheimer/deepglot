import crypto from "crypto";

import { canSendEmail } from "@/lib/email";
import { withLocalePrefix, type SiteLocale } from "@/lib/site-locale";

export const PROJECT_INVITATION_TTL_SECONDS = 60 * 60 * 24 * 7;

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

export function normalizeProjectInvitationEmail(email: string) {
  return email.trim().toLowerCase();
}

export function createProjectInvitationToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashProjectInvitationToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getProjectInvitationExpiresAt(now = new Date()) {
  return new Date(now.getTime() + PROJECT_INVITATION_TTL_SECONDS * 1000);
}

export function getProjectInvitationBaseUrl(
  env: Record<string, string | undefined> = process.env
) {
  const baseUrl =
    normalizeBaseUrl(env.AUTH_URL) ??
    normalizeBaseUrl(env.NEXT_PUBLIC_APP_URL) ??
    getVercelDeploymentBaseUrl(env);

  if (!baseUrl) {
    throw new Error(
      "Missing AUTH_URL, NEXT_PUBLIC_APP_URL, or Vercel system URL for project invitation links."
    );
  }

  return baseUrl;
}

export function buildProjectInvitationUrl({
  token,
  locale,
  baseUrl = getProjectInvitationBaseUrl(),
}: {
  token: string;
  locale: SiteLocale;
  baseUrl?: string;
}) {
  const url = new URL(withLocalePrefix("/accept-invite", locale), baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function canSendProjectInvitationEmail(
  env: Record<string, string | undefined> = process.env
) {
  return canSendEmail(env);
}
