import { db } from "@/lib/db";
import { maybeAutoUpgradeAfterUsage, type AutoUpgradeClient, type AutoUpgradeStripe } from "@/lib/auto-upgrade";

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
          // A revoked preference or changed billing context forbids another
          // paid request. A changed remote state needs manual invoice binding.
          const stripeClient = dependencies.stripeClient ?? (await import("@/lib/stripe")).stripe;
          const remote = await stripeClient.subscriptions.retrieve(row.stripeSubscriptionId);
          const unchanged = !remote.pending_update && remote.items.data[0]?.price.id === row.fromPriceId;
          await client.autoUpgradeAttempt.updateMany({ where: { id: row.id, status: "DISPATCHING" },
            data: { status: unchanged ? "CANCELED" : "UNKNOWN", errorCode: unchanged ? "DISPATCH_CONTEXT_CHANGED" : "UNBOUND_EXTERNAL_CHANGE" } });
        }
      }
    } catch (error) {
      console.error("[auto-upgrade] reconciliation failed", { attemptId: attempt.id, error });
      results.error = (results.error ?? 0) + 1;
    }
  }
  return { inspected: candidates.length, results };
}
