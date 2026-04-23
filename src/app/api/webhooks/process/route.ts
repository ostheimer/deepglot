import { NextRequest, NextResponse } from "next/server";

import { dispatchPendingWebhookDeliveries } from "@/lib/project-webhook-delivery";

export const runtime = "nodejs";

function isAuthorized(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET?.trim();

  if (!configuredSecret) {
    return process.env.NODE_ENV !== "production";
  }

  const authHeader = request.headers.get("authorization");
  const bearerSecret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  const headerSecret = request.headers.get("x-cron-secret");
  const querySecret = new URL(request.url).searchParams.get("secret");

  return [bearerSecret, headerSecret, querySecret].includes(configuredSecret);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await dispatchPendingWebhookDeliveries();

  return NextResponse.json({
    ok: true,
    processed: results.length,
    delivered: results.filter(Boolean).length,
  });
}
