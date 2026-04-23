import { Prisma, type WebhookDeliveryStatus } from "@prisma/client";

import { db } from "@/lib/db";
import {
  buildWebhookHeaders,
  getWebhookNextAttemptAt,
  type ProjectWebhookEventType,
} from "@/lib/webhooks";

export async function queueProjectWebhookEvent(
  {
    projectId,
    eventType,
    payload,
  }: {
    projectId: string;
    eventType: ProjectWebhookEventType;
    payload: Prisma.InputJsonValue;
  },
  tx?: Prisma.TransactionClient
) {
  const client = tx ?? db;
  const endpoints = await client.webhookEndpoint.findMany({
    where: {
      projectId,
      enabled: true,
      eventTypes: {
        has: eventType,
      },
    },
    select: { id: true },
  });

  const deliveries = await Promise.all(
    endpoints.map((endpoint) =>
      client.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          projectId,
          eventType,
          payload,
        },
      })
    )
  );

  return deliveries;
}

export async function dispatchWebhookDelivery(deliveryId: string) {
  const delivery = await db.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });

  if (!delivery || !delivery.endpoint.enabled) {
    return null;
  }

  const payloadString = JSON.stringify(delivery.payload);
  const headers = buildWebhookHeaders(
    delivery.eventType as ProjectWebhookEventType,
    payloadString,
    delivery.endpoint.secret
  );

  try {
    const response = await fetch(delivery.endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: payloadString,
    });
    const responseText = await response.text();
    const wasSuccessful = response.ok;

    await updateDeliveryOutcome({
      deliveryId: delivery.id,
      endpointId: delivery.endpointId,
      status: wasSuccessful ? "SUCCESS" : "FAILED",
      responseStatus: response.status,
      responseBody: responseText.slice(0, 5_000),
      errorMessage: wasSuccessful ? null : `HTTP ${response.status}`,
      attemptCount: delivery.attemptCount + 1,
    });

    return wasSuccessful;
  } catch (error) {
    await updateDeliveryOutcome({
      deliveryId: delivery.id,
      endpointId: delivery.endpointId,
      status: "FAILED",
      responseStatus: null,
      responseBody: null,
      errorMessage:
        error instanceof Error ? error.message : "Webhook delivery failed.",
      attemptCount: delivery.attemptCount + 1,
    });

    return false;
  }
}

export async function dispatchPendingWebhookDeliveries(limit = 25) {
  const deliveries = await db.webhookDelivery.findMany({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  return Promise.all(deliveries.map((delivery) => dispatchWebhookDelivery(delivery.id)));
}

async function updateDeliveryOutcome({
  deliveryId,
  endpointId,
  status,
  responseStatus,
  responseBody,
  errorMessage,
  attemptCount,
}: {
  deliveryId: string;
  endpointId: string;
  status: WebhookDeliveryStatus;
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  attemptCount: number;
}) {
  const nextAttemptAt =
    status === "FAILED" ? getWebhookNextAttemptAt(attemptCount - 1) : null;
  const finalStatus =
    status === "FAILED" && nextAttemptAt ? "PENDING" : status;

  await db.$transaction(async (tx) => {
    await tx.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: finalStatus,
        attemptCount,
        lastAttemptAt: new Date(),
        responseStatus,
        responseBody,
        errorMessage,
        nextAttemptAt: nextAttemptAt ?? new Date(),
      },
    });

    await tx.webhookEndpoint.update({
      where: { id: endpointId },
      data: {
        lastDeliveryStatus: finalStatus,
        lastDeliveryAt: new Date(),
        lastDeliveryCode: responseStatus ?? undefined,
      },
    });
  });
}
