import { NextRequest, NextResponse } from "next/server";

import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import {
  PAGE_VIEW_RETENTION_DAYS,
  getPageViewRetentionCutoff,
} from "@/lib/page-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cutoff = getPageViewRetentionCutoff();
    const result = await db.pageView.deleteMany({
      where: {
        createdAt: { lt: cutoff },
      },
    });

    return NextResponse.json({
      ok: true,
      deleted: result.count,
      retentionDays: PAGE_VIEW_RETENTION_DAYS,
      cutoff: cutoff.toISOString(),
    });
  } catch (error) {
    console.error("[GET /api/cron/page-view-retention] Cleanup failed:", error);

    return NextResponse.json(
      { ok: false, error: "Page-view retention cleanup failed." },
      { status: 500 },
    );
  }
}
