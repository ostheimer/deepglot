import { z } from "zod";

export const PAGE_VIEW_RETENTION_DAYS = 90;
export const PAGE_VIEW_MAX_URL_PATH_LENGTH = 2_048;
export const PAGE_VIEW_MAX_REQUEST_BODY_BYTES = 4_096;
export const PAGE_VIEW_RATE_LIMIT_SCOPE = "plugin:page-view";
export const PAGE_VIEW_RETENTION_CRON_PATH = "/api/cron/page-view-retention";
export const PAGE_VIEW_RETENTION_CRON_SCHEDULE = "17 3 * * *";

const DEFAULT_PAGE_VIEW_RATE_LIMIT_PER_MINUTE = 600;
const MAX_PAGE_VIEW_RATE_LIMIT_PER_MINUTE = 100_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const PAGE_VIEW_PATH_ORIGIN = "https://pageviews.deepglot.invalid";
const BOT_USER_AGENT =
  /bot|crawler|spider|facebookexternalhit|wget|curl|python-requests|httpclient|headless|lighthouse|gtmetrix|ptst/i;

type PageViewRateLimitEnv = {
  PAGE_VIEW_RATE_LIMIT_PER_MINUTE?: string;
};

/**
 * Normalize only a site-relative pathname. Reject rather than strip query
 * strings/fragments so potentially sensitive values never enter persistence.
 */
export function normalizePageViewPath(rawPath: string): string | null {
  if (
    rawPath.length === 0 ||
    rawPath.length > PAGE_VIEW_MAX_URL_PATH_LENGTH ||
    !rawPath.startsWith("/") ||
    rawPath.startsWith("//") ||
    rawPath.includes("\\") ||
    rawPath.includes("?") ||
    rawPath.includes("#") ||
    [...rawPath].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  ) {
    return null;
  }

  try {
    const normalized = new URL(rawPath, PAGE_VIEW_PATH_ORIGIN);

    if (
      normalized.origin !== PAGE_VIEW_PATH_ORIGIN ||
      normalized.search ||
      normalized.hash ||
      normalized.pathname.length > PAGE_VIEW_MAX_URL_PATH_LENGTH
    ) {
      return null;
    }

    // Malformed percent escapes must not be stored under an ambiguous path.
    decodeURIComponent(normalized.pathname);
    return normalized.pathname;
  } catch {
    return null;
  }
}

export const pageViewEventSchema = z
  .object({
    eventId: z.string().uuid(),
    urlPath: z
      .string()
      .min(1)
      .max(PAGE_VIEW_MAX_URL_PATH_LENGTH)
      .superRefine((value, context) => {
        if (normalizePageViewPath(value) === null) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "URL must be a site-relative pathname without query parameters or fragments.",
          });
        }
      })
      .transform((value) => normalizePageViewPath(value)!),
    langTo: z
      .string()
      .regex(/^[a-z]{2}$/i, "Target language must be an ISO 639-1 code.")
      .transform((value) => value.toLowerCase()),
  })
  .strict();

export type PageViewEvent = z.infer<typeof pageViewEventSchema>;

export function isPageViewBot(userAgent: string | null | undefined): boolean {
  return userAgent ? BOT_USER_AGENT.test(userAgent) : false;
}

export function getPageViewRetentionCutoff(now = new Date()): Date {
  return new Date(
    now.getTime() - PAGE_VIEW_RETENTION_DAYS * MILLISECONDS_PER_DAY,
  );
}

export function getPageViewRateLimitPerMinute(
  env: PageViewRateLimitEnv = {
    PAGE_VIEW_RATE_LIMIT_PER_MINUTE: process.env.PAGE_VIEW_RATE_LIMIT_PER_MINUTE,
  },
): number {
  const rawLimit = env.PAGE_VIEW_RATE_LIMIT_PER_MINUTE?.trim();

  if (!rawLimit || !/^\d+$/.test(rawLimit)) {
    return DEFAULT_PAGE_VIEW_RATE_LIMIT_PER_MINUTE;
  }

  const limit = Number(rawLimit);

  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_VIEW_RATE_LIMIT_PER_MINUTE
  ) {
    return DEFAULT_PAGE_VIEW_RATE_LIMIT_PER_MINUTE;
  }

  return limit;
}
