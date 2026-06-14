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
