import { NextRequest, NextResponse } from "next/server";
import { AUDIT_RETENTION_DAYS, deleteExpiredAuditEvents } from "@/lib/audit-retention";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await deleteExpiredAuditEvents(db);
    return NextResponse.json({ ok: true, deleted: result.count, retentionDays: AUDIT_RETENTION_DAYS });
  } catch (error) {
    console.error("[GET /api/cron/audit-retention] Cleanup failed:", error);
    return NextResponse.json({ ok: false, error: "Audit retention cleanup failed." }, { status: 500 });
  }
}
