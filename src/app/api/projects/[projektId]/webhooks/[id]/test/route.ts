import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { dispatchWebhookDelivery } from "@/lib/project-webhook-delivery";
import {
  getAuthenticatedUserId,
  userHasProjectAccess,
} from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projektId: string; id: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId, id } = await params;

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

  const endpoint = await db.webhookEndpoint.findFirst({
    where: { id, projectId: projektId },
  });

  if (!endpoint) {
    return NextResponse.json(
      { error: t(locale, "Webhook nicht gefunden", "Webhook not found") },
      { status: 404 }
    );
  }

  const eventType = endpoint.eventTypes[0] ?? "translation.updated";
  const delivery = await db.webhookDelivery.create({
    data: {
      endpointId: endpoint.id,
      projectId: projektId,
      eventType,
      payload: {
        type: eventType,
        test: true,
        projectId: projektId,
        sentAt: new Date().toISOString(),
      },
    },
  });

  const ok = await dispatchWebhookDelivery(delivery.id);
  const updatedDelivery = await db.webhookDelivery.findUnique({
    where: { id: delivery.id },
  });

  return NextResponse.json({
    ok,
    delivery: updatedDelivery,
  });
}
