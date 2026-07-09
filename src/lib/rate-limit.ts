import crypto from "node:crypto";

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const TRANSLATE_RATE_LIMIT_SCOPE = "translate";
export const PLUGIN_RATE_LIMIT_SCOPE = "plugin";
export const AUTH_PASSWORD_RESET_RATE_LIMIT_SCOPE = "auth:password-reset";

/**
 * Per-project fresh-word velocity limit (#203). Unlike the monthly quota (a
 * total) and the per-minute request limit (a count), this caps how many
 * *fresh, provider-billed words* one project can spend per rolling window —
 * the authoritative, atomic, per-project bound the WordPress plugin's soft
 * per-IP caps (v0.8.4) cannot provide. It stops an attacker (even one rotating
 * IPs through the dynamic-translate proxy) from draining a victim's whole
 * monthly quota in minutes, while sitting well above legitimate traffic.
 */
export const TRANSLATE_WORD_VELOCITY_SCOPE = "translate:word-velocity";
export const TRANSLATE_WORD_VELOCITY_WINDOW_MS = 3_600_000; // 1 hour

const DEFAULT_TRANSLATE_RATE_LIMIT_PER_MINUTE = 60;
const DEFAULT_PLUGIN_RATE_LIMIT_PER_MINUTE = 120;
const DEFAULT_AUTH_RATE_LIMIT_PER_MINUTE = 5;
const DEFAULT_TRANSLATE_WORD_VELOCITY_PER_HOUR = 50_000;

type RateLimitEnv = {
  TRANSLATE_RATE_LIMIT_PER_MINUTE?: string;
  PLUGIN_RATE_LIMIT_PER_MINUTE?: string;
  AUTH_RATE_LIMIT_PER_MINUTE?: string;
  TRANSLATE_WORD_VELOCITY_PER_HOUR?: string;
};

type RateLimitBucketRecord = {
  scope: string;
  subjectHash: string;
  count: number;
  resetAt: Date;
};

type RateLimitBucketData = {
  scope: string;
  subjectHash: string;
  now: Date;
  resetAt: Date;
  /** Amount to add to the window counter (1 for request limits, word count
   *  for the fresh-word velocity limit). */
  cost: number;
};

export type RateLimitStore = {
  consumeBucket(data: RateLimitBucketData): Promise<RateLimitBucketRecord>;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
};

export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, RateLimitBucketRecord>();

  async consumeBucket(data: RateLimitBucketData) {
    const key = this.key(data.scope, data.subjectHash);
    const existing = this.buckets.get(key);
    const isExpired = !existing || existing.resetAt <= data.now;
    const count = isExpired ? data.cost : existing.count + data.cost;
    const resetAt = isExpired ? data.resetAt : existing.resetAt;
    const bucket = {
      scope: data.scope,
      subjectHash: data.subjectHash,
      count,
      resetAt,
    };
    this.buckets.set(key, bucket);
    return bucket;
  }

  private key(scope: string, subjectHash: string) {
    return `${scope}\0${subjectHash}`;
  }
}

class PrismaRateLimitStore implements RateLimitStore {
  async consumeBucket(data: RateLimitBucketData) {
    const { db } = await import("@/lib/db");

    const rows = await db.$queryRaw<RateLimitBucketRecord[]>`
      INSERT INTO "RateLimitBucket"
        ("id", "scope", "subjectHash", "count", "resetAt", "createdAt", "updatedAt")
      VALUES (
        ${crypto.randomUUID()},
        ${data.scope},
        ${data.subjectHash},
        ${data.cost},
        ${data.resetAt},
        ${data.now},
        ${data.now}
      )
      ON CONFLICT ("scope", "subjectHash")
      DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitBucket"."resetAt" <= ${data.now} THEN ${data.cost}
          ELSE "RateLimitBucket"."count" + ${data.cost}
        END,
        "resetAt" = CASE
          WHEN "RateLimitBucket"."resetAt" <= ${data.now} THEN ${data.resetAt}
          ELSE "RateLimitBucket"."resetAt"
        END,
        "updatedAt" = ${data.now}
      RETURNING "scope", "subjectHash", "count", "resetAt"
    `;

    if (!rows[0]) {
      throw new Error("Rate-limit bucket upsert returned no row.");
    }

    return rows[0];
  }
}

export function hashRateLimitSubject(scope: string, subject: string) {
  return crypto
    .createHash("sha256")
    .update(scope)
    .update("\0")
    .update(subject)
    .digest("hex");
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function getRateLimitConfig(env: RateLimitEnv = process.env as RateLimitEnv) {
  return {
    translatePerMinute: parsePositiveInteger(
      env.TRANSLATE_RATE_LIMIT_PER_MINUTE,
      DEFAULT_TRANSLATE_RATE_LIMIT_PER_MINUTE
    ),
    pluginPerMinute: parsePositiveInteger(
      env.PLUGIN_RATE_LIMIT_PER_MINUTE,
      DEFAULT_PLUGIN_RATE_LIMIT_PER_MINUTE
    ),
    authPerMinute: parsePositiveInteger(
      env.AUTH_RATE_LIMIT_PER_MINUTE,
      DEFAULT_AUTH_RATE_LIMIT_PER_MINUTE
    ),
    translateWordVelocityPerHour: parsePositiveInteger(
      env.TRANSLATE_WORD_VELOCITY_PER_HOUR,
      DEFAULT_TRANSLATE_WORD_VELOCITY_PER_HOUR
    ),
  };
}

/**
 * Atomically reserve `words` fresh, provider-billed words against a project's
 * rolling velocity window. Returns `allowed: false` (with retry timing) once
 * the window budget is spent. Reserving is a single atomic upsert, so
 * concurrent requests cannot overshoot the cap (unlike the plugin's per-IP
 * transient caps). Only call this for real fresh spend — not cache hits, bots,
 * or health probes.
 */
export async function consumeTranslateWordVelocity({
  projectId,
  words,
  limit,
  now = new Date(),
  store,
}: {
  projectId: string;
  words: number;
  limit: number;
  now?: Date;
  store?: RateLimitStore;
}): Promise<RateLimitResult> {
  return consumeRateLimit({
    scope: TRANSLATE_WORD_VELOCITY_SCOPE,
    subject: projectId,
    limit,
    cost: words,
    windowMs: TRANSLATE_WORD_VELOCITY_WINDOW_MS,
    now,
    ...(store ? { store } : {}),
  });
}

export function buildRateLimitHeaders(result: RateLimitResult) {
  return {
    "Retry-After": String(result.retryAfterSeconds),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": result.resetAt.toISOString(),
  };
}

function secondsUntil(resetAt: Date, now: Date) {
  return Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
}

export async function consumeRateLimit({
  scope,
  subject,
  limit,
  cost = 1,
  windowMs = RATE_LIMIT_WINDOW_MS,
  now = new Date(),
  store = new PrismaRateLimitStore(),
}: {
  scope: string;
  subject: string;
  limit: number;
  /** Units to consume from the window (1 for request limits, word count for
   *  the fresh-word velocity limit). Values < 1 are treated as 1. */
  cost?: number;
  windowMs?: number;
  now?: Date;
  store?: RateLimitStore;
}): Promise<RateLimitResult> {
  const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 1;
  const safeLimit = Math.max(1, normalizedLimit);
  const safeCost = Number.isFinite(cost) ? Math.max(1, Math.floor(cost)) : 1;
  const subjectHash = hashRateLimitSubject(scope, subject);
  const windowResetAt = new Date(now.getTime() + windowMs);
  const bucket = await store.consumeBucket({
    scope,
    subjectHash,
    now,
    resetAt: windowResetAt,
    cost: safeCost,
  });
  const allowed = bucket.count <= safeLimit;

  if (!allowed) {
    return {
      allowed: false,
      limit: safeLimit,
      remaining: 0,
      resetAt: bucket.resetAt,
      retryAfterSeconds: secondsUntil(bucket.resetAt, now),
    };
  }

  return {
    allowed: true,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSeconds: 0,
  };
}
