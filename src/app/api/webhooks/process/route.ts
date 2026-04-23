import { NextRequest, NextResponse } from "next/server";

import { dispatchPendingWebhookDeliveries } from "@/lib/project-webhook-delivery";
import { isWebhookProcessRequestAuthorized } from "@/lib/webhook-cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isWebhookProcessRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await dispatchPendingWebhookDeliveries();

  return NextResponse.json({
    ok: true,
    processed: results.length,
    delivered: results.filter(Boolean).length,
  });
}
