import type { WebhookDeliveryStatus } from "@prisma/client";

export type WebhookProcessorSummary = {
  status: "SUCCESS" | "FAILED";
  processed: number;
  delivered: number;
  failed: number;
  skipped: number;
  pendingRemaining: number;
  durationMs: number;
  errorMessage?: string;
};

export function buildWebhookProcessorSummary({
  results,
  pendingRemaining,
  durationMs,
  errorMessage,
}: {
  results: Array<boolean | null>;
  pendingRemaining: number;
  durationMs: number;
  errorMessage?: string;
}): WebhookProcessorSummary {
  const delivered = results.filter((result) => result === true).length;
  const failed = results.filter((result) => result === false).length;
  const skipped = results.filter((result) => result === null).length;

  return {
    status: errorMessage ? "FAILED" : "SUCCESS",
    processed: results.length,
    delivered,
    failed,
    skipped,
    pendingRemaining,
    durationMs,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

export function normalizeWebhookDeliveryStatus(
  value: string | null
): WebhookDeliveryStatus | null {
  const normalized = value?.trim().toUpperCase();

  if (
    normalized === "PENDING" ||
    normalized === "SUCCESS" ||
    normalized === "FAILED"
  ) {
    return normalized;
  }

  return null;
}

export async function recordWebhookProcessorRun(
  summary: WebhookProcessorSummary
) {
  const { db } = await import("@/lib/db");

  return db.webhookProcessorRun.create({
    data: {
      status: summary.status,
      processedCount: summary.processed,
      deliveredCount: summary.delivered,
      failedCount: summary.failed,
      pendingRemainingCount: summary.pendingRemaining,
      durationMs: summary.durationMs,
      errorMessage: summary.errorMessage ?? null,
    },
  });
}
