import crypto from "crypto";

export const PROJECT_WEBHOOK_EVENT_TYPES = [
  "translation.created",
  "translation.updated",
  "translation.manual_updated",
  "glossary.upserted",
  "glossary.deleted",
  "slug.upserted",
  "import.completed",
] as const;

export type ProjectWebhookEventType =
  (typeof PROJECT_WEBHOOK_EVENT_TYPES)[number];

const RETRY_DELAYS_SECONDS = [60, 300, 900] as const;

export function createWebhookTimestamp(date = new Date()) {
  return Math.floor(date.getTime() / 1000).toString();
}

export function signWebhookPayload(
  payload: string,
  timestamp: string,
  secret: string
) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
}

export function buildWebhookHeaders(
  eventType: ProjectWebhookEventType,
  payload: string,
  secret: string,
  date = new Date()
) {
  const timestamp = createWebhookTimestamp(date);

  return {
    "X-Deepglot-Event": eventType,
    "X-Deepglot-Timestamp": timestamp,
    "X-Deepglot-Signature": signWebhookPayload(payload, timestamp, secret),
  };
}

export function getWebhookRetryDelaySeconds(attemptCount: number) {
  return RETRY_DELAYS_SECONDS[Math.max(0, attemptCount)] ?? null;
}

export function getWebhookNextAttemptAt(
  attemptCount: number,
  now = new Date()
) {
  const delay = getWebhookRetryDelaySeconds(attemptCount);

  if (delay === null) {
    return null;
  }

  return new Date(now.getTime() + delay * 1000);
}
