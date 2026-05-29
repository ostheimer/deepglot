import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

import { Prisma, type WebhookDeliveryStatus } from "@prisma/client";

import { db } from "@/lib/db";
import {
  buildWebhookHeaders,
  getWebhookNextAttemptAt,
  type ProjectWebhookEventType,
} from "@/lib/webhooks";
import {
  parsePublicWebhookUrl,
  resolveWebhookTarget,
} from "@/lib/webhook-url-safety";

// Cap the stored response body. The SSRF guard already blocks internal targets;
// this further limits how much of any response can be read back via the
// deliveries API.
const MAX_WEBHOOK_RESPONSE_BODY = 512;
const WEBHOOK_REQUEST_TIMEOUT_MS = 10_000;

/**
 * POST the webhook payload, pinned to a pre-validated public IP. Using
 * node:http(s) with a fixed `lookup` guarantees the connection goes to the
 * exact address we checked (no DNS re-resolution / rebinding), and these
 * clients do not follow redirects, so a 3xx can't bounce into an internal host.
 */
function sendWebhookRequest(
  url: URL,
  options: {
    headers: Record<string, string>;
    body: string;
    address: string;
    family: number;
  }
): Promise<{ status: number; body: string }> {
  const transport = url.protocol === "https:" ? https : http;
  // Always resolve to the pre-validated address, regardless of how Node invokes
  // the lookup: (host, callback), (host, options, callback), and all:true
  // (array result) vs all:false (single result).
  const pinnedLookup = ((
    _hostname: string,
    optsOrCallback: unknown,
    maybeCallback?: unknown
  ) => {
    const callback = (
      typeof optsOrCallback === "function" ? optsOrCallback : maybeCallback
    ) as (
      err: NodeJS.ErrnoException | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number
    ) => void;
    const wantsAll =
      typeof optsOrCallback === "object" &&
      optsOrCallback !== null &&
      (optsOrCallback as { all?: boolean }).all === true;

    if (wantsAll) {
      callback(null, [{ address: options.address, family: options.family }]);
    } else {
      callback(null, options.address, options.family);
    }
  }) as unknown as LookupFunction;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      { method: "POST", headers: options.headers, lookup: pinnedLookup },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (body.length < MAX_WEBHOOK_RESPONSE_BODY) {
            body += chunk;
          }
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body });
        });
      }
    );

    request.setTimeout(WEBHOOK_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("Webhook request timed out."));
    });
    request.on("error", reject);
    request.write(options.body);
    request.end();
  });
}

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
    // SSRF guard: re-validate the URL and ensure the host resolves to a public
    // address right before fetching (defeats DNS rebinding). Redirects are not
    // followed so a public URL can't bounce into an internal target.
    const targetUrl = parsePublicWebhookUrl(delivery.endpoint.url);
    const target = await resolveWebhookTarget(targetUrl.hostname);

    const response = await sendWebhookRequest(targetUrl, {
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: payloadString,
      address: target.address,
      family: target.family,
    });
    const wasSuccessful = response.status >= 200 && response.status < 300;

    await updateDeliveryOutcome({
      deliveryId: delivery.id,
      endpointId: delivery.endpointId,
      status: wasSuccessful ? "SUCCESS" : "FAILED",
      responseStatus: response.status,
      responseBody: response.body.slice(0, MAX_WEBHOOK_RESPONSE_BODY),
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

export async function countDuePendingWebhookDeliveries(now = new Date()) {
  return db.webhookDelivery.count({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: now },
    },
  });
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
