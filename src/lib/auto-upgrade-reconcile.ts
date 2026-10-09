import { db } from "@/lib/db";
import { maybeAutoUpgradeAfterUsage, notifyOwners, type AutoUpgradeClient, type AutoUpgradeStripe } from "@/lib/auto-upgrade";

/** Bounded scheduler producer: resolves in-flight attempts even if translation traffic stops. */
export async function reconcileAutoUpgradeAttempts(dependencies: { client?: AutoUpgradeClient; stripeClient?: AutoUpgradeStripe; now?: Date; env?: Record<string, string | undefined> } = {}) {
  const client = dependencies.client ?? db;
  const now = dependencies.now ?? new Date();
  const candidates = await client.autoUpgradeAttempt.findMany({ where: { status: { in: ["DISPATCHING", "PAYMENT_PENDING", "AWAIT_INVOICE"] } },
    orderBy: { createdAt: "asc" }, take: 20, select: { id: true, organizationId: true, month: true, status: true } });
  const results: Record<string, number> = {};
  for (const attempt of candidates) {
    try {
      const outcome = await maybeAutoUpgradeAfterUsage(attempt.organizationId, attempt.month, dependencies);
      results[outcome] = (results[outcome] ?? 0) + 1;
      if (["disabled", "configuration_changed", "ineligible"].includes(outcome) && attempt.status === "DISPATCHING") {
        const row = await client.autoUpgradeAttempt.findUnique({ where: { id: attempt.id } });
        if (row && now.getTime() - row.claimedAt.getTime() > 10 * 60_000) {
          // DISPATCHING may have reached Stripe even when a later read still
          // looks unchanged. Never release an unknown external outcome as a
          // canceled attempt, and never issue a different key after opt-out.
          await client.autoUpgradeAttempt.updateMany({ where: { id: row.id, status: "DISPATCHING" },
            data: { status: "UNKNOWN", errorCode: "DISPATCH_CONTEXT_CHANGED" } });
          await notifyOwners(client, row.id, row.organizationId, "RECONCILE_REQUIRED");
        }
      }
    } catch (error) {
      console.error("[auto-upgrade] reconciliation failed", { attemptId: attempt.id, error });
      results.error = (results.error ?? 0) + 1;
    }
  }
  return { inspected: candidates.length, results };
}
