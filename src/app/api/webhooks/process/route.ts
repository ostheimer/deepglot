import { NextRequest, NextResponse } from "next/server";

import {
  countDuePendingWebhookDeliveries,
  dispatchPendingWebhookDeliveries,
} from "@/lib/project-webhook-delivery";
import {
  buildWebhookProcessorSummary,
  recordWebhookProcessorRun,
} from "@/lib/webhook-processor";
import { isWebhookProcessRequestAuthorized } from "@/lib/webhook-cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isWebhookProcessRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const results = await dispatchPendingWebhookDeliveries();
    const pendingRemaining = await countDuePendingWebhookDeliveries();
    const summary = buildWebhookProcessorSummary({
      results,
      pendingRemaining,
      durationMs: Date.now() - startedAt,
    });
    const run = await recordWebhookProcessorRun(summary);

    return NextResponse.json({
      ok: true,
      runId: run.id,
      processed: summary.processed,
      delivered: summary.delivered,
      failed: summary.failed,
      pendingRemaining: summary.pendingRemaining,
      durationMs: summary.durationMs,
    });
  } catch (error) {
    const summary = buildWebhookProcessorSummary({
      results: [],
      pendingRemaining: 0,
      durationMs: Date.now() - startedAt,
      errorMessage:
        error instanceof Error ? error.message : "Webhook processor failed.",
    });
    const run = await recordWebhookProcessorRun(summary).catch(() => null);

    return NextResponse.json(
      {
        ok: false,
        runId: run?.id ?? null,
        processed: summary.processed,
        delivered: summary.delivered,
        failed: summary.failed,
        pendingRemaining: summary.pendingRemaining,
        durationMs: summary.durationMs,
        error: summary.errorMessage,
      },
      { status: 500 }
    );
  }
}
