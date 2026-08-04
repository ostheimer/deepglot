import { NextRequest, NextResponse } from "next/server";

import { isActivityDigestRequestAuthorized } from "@/lib/activity-digest-cron";
import { processWeeklyActivityDigests } from "@/lib/activity-digest-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isActivityDigestRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processWeeklyActivityDigests();
    const ok = result.configured && result.failed === 0;
    return NextResponse.json(
      { ok, ...result },
      { status: !result.configured ? 503 : result.failed > 0 ? 500 : 200 }
    );
  } catch (error) {
    console.error("[GET /api/cron/activity-digest] Digest run failed:", error);
    return NextResponse.json(
      { ok: false, error: "Activity digest run failed." },
      { status: 500 }
    );
  }
}
