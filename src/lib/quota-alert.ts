import { Prisma } from "@prisma/client";

import { getAppBaseUrl } from "@/lib/billing";
import { db } from "@/lib/db";
import { canSendEmail, sendQuotaAlertEmail } from "@/lib/email";

/**
 * Owner-facing monthly word-quota alerting (#148).
 *
 * The dashboard banner only helps operators who log in; this emails the org
 * owner so they hear about an exhausted quota even if they do not. Two moments
 * trigger an alert, each at most once per org per month (deduped via the
 * UsageAlert table's unique (organizationId, month, threshold)):
 *   • 90% — an accepted translation pushed usage across the warning ratio;
 *   • 100% — a request was rejected with 402 (the limit is effectively reached;
 *     large batches are rejected before they increment, so usage rarely crosses
 *     100% by increment — the 402 itself is the "reached" signal).
 *
 * The pure threshold math lives in `quota-usage` (no DB import) so it stays
 * unit-testable; this module owns only the IO orchestration.
 */

/**
 * Sends an owner alert for each given threshold, at most once per org/month/
 * threshold. Never throws: a failed alert must not fail the translation request
 * that triggered it. To dedup across concurrent requests the marker row is
 * claimed BEFORE sending and rolled back if the send fails, so it can retry.
 */
export async function maybeSendQuotaAlerts({
  organizationId,
  organizationName,
  month,
  thresholds,
  wordsUsed,
  wordsLimit,
  signal,
}: {
  organizationId: string;
  organizationName: string;
  month: number;
  thresholds: number[];
  wordsUsed: number;
  wordsLimit: number;
  signal?: AbortSignal;
}): Promise<void> {
  if (thresholds.length === 0 || !canSendEmail()) {
    return;
  }

  try {
    const owner = await db.organizationMember.findFirst({
      where: { organizationId, role: "OWNER" },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { email: true } } },
    });

    const to = owner?.user?.email;
    if (!to) {
      return;
    }

    const dashboardUrl = `${getAppBaseUrl()}/abonnement/nutzung`;

    for (const threshold of thresholds) {
      // Claim the slot first so two concurrent crossers can't both send.
      try {
        await db.usageAlert.create({
          data: { organizationId, month, threshold },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue; // already alerted this month for this threshold
        }
        throw error;
      }

      try {
        await sendQuotaAlertEmail({
          to,
          organizationName,
          threshold,
          wordsUsed,
          wordsLimit,
          dashboardUrl,
          signal,
        });
      } catch (sendError) {
        // Release the claim so a later request can retry the send.
        await db.usageAlert
          .deleteMany({ where: { organizationId, month, threshold } })
          .catch(() => {});
        throw sendError;
      }
    }
  } catch (error) {
    console.error("[quota-alert] failed to send quota alert", error);
  }
}
