import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  getAuthenticatedUserId,
  userHasProjectAccess,
} from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId } = await params;

  if (!userId) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  if (!(await userHasProjectAccess(userId, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const [latestProcessorRun, statusCounts, pendingDueCount, latestDelivery] =
    await Promise.all([
      db.webhookProcessorRun.findFirst({
        orderBy: { createdAt: "desc" },
      }),
      db.webhookDelivery.groupBy({
        by: ["status"],
        where: { projectId: projektId },
        _count: { _all: true },
      }),
      db.webhookDelivery.count({
        where: {
          projectId: projektId,
          status: "PENDING",
          nextAttemptAt: { lte: new Date() },
        },
      }),
      db.webhookDelivery.findFirst({
        where: { projectId: projektId },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

  const deliveryCounts = { PENDING: 0, SUCCESS: 0, FAILED: 0 };
  for (const item of statusCounts) {
    deliveryCounts[item.status] = item._count._all;
  }

  return NextResponse.json({
    health: {
      latestProcessorRun,
      deliveryCounts,
      pendingDueCount,
      latestDelivery,
    },
  });
}
