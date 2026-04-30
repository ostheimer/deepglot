import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  getAuthenticatedUserId,
  userHasProjectAccess,
} from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";
import { normalizeWebhookDeliveryStatus } from "@/lib/webhook-processor";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

function clampLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "25", 10);

  if (Number.isNaN(parsed)) return 25;

  return Math.min(Math.max(parsed, 1), 100);
}

export async function GET(
  request: NextRequest,
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

  const { searchParams } = new URL(request.url);
  const status = normalizeWebhookDeliveryStatus(searchParams.get("status"));
  const endpointId = searchParams.get("endpointId")?.trim();
  const cursor = searchParams.get("cursor")?.trim();
  const limit = clampLimit(searchParams.get("limit"));

  const deliveries = await db.webhookDelivery.findMany({
    where: {
      projectId: projektId,
      ...(status ? { status } : {}),
      ...(endpointId ? { endpointId } : {}),
    },
    include: {
      endpoint: {
        select: {
          id: true,
          url: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const page = deliveries.slice(0, limit);
  const nextCursor = deliveries.length > limit ? deliveries[limit]?.id : null;

  return NextResponse.json({
    deliveries: page,
    nextCursor,
  });
}
