/**
 * Shared monthly-word-quota thresholds for operator-facing warnings (#148).
 *
 * Kept pure and dependency-free so both the dashboard banner (server component)
 * and any future proactive alerting can classify usage the same way.
 */

/** Fraction of the limit at which the "approaching" warning starts. */
export const QUOTA_WARNING_RATIO = 0.9;

export type QuotaUsageLevel = "ok" | "warning" | "reached";

/**
 * Classifies current word usage against the effective monthly limit.
 * A non-positive limit is treated as "ok" (nothing meaningful to warn about).
 */
export function quotaUsageLevel(
  wordsUsed: number,
  wordsLimit: number,
): QuotaUsageLevel {
  if (wordsLimit <= 0) {
    return "ok";
  }

  const ratio = wordsUsed / wordsLimit;

  if (ratio >= 1) {
    return "reached";
  }

  if (ratio >= QUOTA_WARNING_RATIO) {
    return "warning";
  }

  return "ok";
}

/**
 * Percent thresholds the owner quota emails alert on. 90 mirrors the dashboard
 * QUOTA_WARNING_RATIO; 100 is the hard limit.
 */
export const QUOTA_ALERT_THRESHOLDS: readonly number[] = [
  Math.round(QUOTA_WARNING_RATIO * 100),
  100,
];

/**
 * Returns the alert thresholds an accepted increment newly crossed — those
 * at-or-below `usedAfter` but strictly above `usedBefore`. Pure and IO-free so
 * the translate hot path only does DB/email work on the rare crossing request.
 */
export function crossedQuotaThresholds(
  usedBefore: number,
  usedAfter: number,
  limit: number,
): number[] {
  if (limit <= 0 || usedAfter <= usedBefore) {
    return [];
  }

  return QUOTA_ALERT_THRESHOLDS.filter((threshold) => {
    const cutoff = (threshold / 100) * limit;
    return usedBefore < cutoff && usedAfter >= cutoff;
  });
}
