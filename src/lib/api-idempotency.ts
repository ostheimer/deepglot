import crypto from "node:crypto";
import { performance } from "node:perf_hooks";

export const API_IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const API_IDEMPOTENCY_PROCESSING_LEASE_MS = 5 * 60 * 1_000;
export const API_IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export type StoredApiResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

type ClaimInput = {
  scope: string;
  keyHash: string;
  requestHash: string;
  ownerToken: string;
  now: Date;
  expiresAt: Date;
  leaseExpiresAt: Date;
};

type ClaimResult =
  | { kind: "acquired" }
  | { kind: "completed"; response: StoredApiResponse; expiresAt: Date }
  | { kind: "processing"; leaseExpiresAt: Date }
  | { kind: "conflict" };

type CompletionInput = {
  scope: string;
  keyHash: string;
  ownerToken: string;
  response: StoredApiResponse;
  expiresAt: Date;
};

type ReleaseInput = Pick<
  CompletionInput,
  "scope" | "keyHash" | "ownerToken"
>;

type WaitInput = {
  scope: string;
  keyHash: string;
  requestHash: string;
  leaseExpiresAt: Date;
};

type WaitResult =
  | { kind: "completed"; response: StoredApiResponse; expiresAt: Date }
  | { kind: "conflict" }
  | { kind: "retry" };

export interface ApiIdempotencyStore {
  claim(input: ClaimInput): Promise<ClaimResult>;
  complete(input: CompletionInput): Promise<void>;
  release(input: ReleaseInput): Promise<void>;
  waitForCompletion(input: WaitInput): Promise<WaitResult>;
  deleteExpired(now?: Date): Promise<number>;
}

type MemoryRecord = {
  requestHash: string;
  ownerToken: string | null;
  status: "PROCESSING" | "COMPLETED";
  response: StoredApiResponse | null;
  expiresAt: Date;
  leaseExpiresAt: Date;
  completion: Promise<WaitResult>;
  resolveCompletion: (result: WaitResult) => void;
};

function createCompletionSignal() {
  let resolveCompletion!: (result: WaitResult) => void;
  const completion = new Promise<WaitResult>((resolve) => {
    resolveCompletion = resolve;
  });
  return { completion, resolveCompletion };
}

export class MemoryApiIdempotencyStore implements ApiIdempotencyStore {
  private records = new Map<string, MemoryRecord>();

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const mapKey = this.mapKey(input.scope, input.keyHash);
    const existing = this.records.get(mapKey);
    const expired = existing && existing.expiresAt <= input.now;
    const staleLease =
      existing?.status === "PROCESSING" &&
      existing.requestHash === input.requestHash &&
      existing.leaseExpiresAt <= input.now;

    if (!existing || expired || staleLease) {
      existing?.resolveCompletion({ kind: "retry" });
      const signal = createCompletionSignal();
      this.records.set(mapKey, {
        requestHash: input.requestHash,
        ownerToken: input.ownerToken,
        status: "PROCESSING",
        response: null,
        expiresAt: input.expiresAt,
        leaseExpiresAt: input.leaseExpiresAt,
        ...signal,
      });
      return { kind: "acquired" };
    }

    if (existing.requestHash !== input.requestHash) {
      return { kind: "conflict" };
    }

    if (existing.status === "COMPLETED" && existing.response) {
      return {
        kind: "completed",
        response: existing.response,
        expiresAt: existing.expiresAt,
      };
    }

    return { kind: "processing", leaseExpiresAt: existing.leaseExpiresAt };
  }

  async complete(input: CompletionInput) {
    const record = this.records.get(this.mapKey(input.scope, input.keyHash));
    if (
      !record ||
      record.status !== "PROCESSING" ||
      record.ownerToken !== input.ownerToken
    ) {
      throw new Error("The idempotency processing lease is no longer owned.");
    }

    record.status = "COMPLETED";
    record.ownerToken = null;
    record.response = input.response;
    record.expiresAt = input.expiresAt;
    record.resolveCompletion({
      kind: "completed",
      response: input.response,
      expiresAt: input.expiresAt,
    });
  }

  async release(input: ReleaseInput) {
    const mapKey = this.mapKey(input.scope, input.keyHash);
    const record = this.records.get(mapKey);
    if (
      record?.status === "PROCESSING" &&
      record.ownerToken === input.ownerToken
    ) {
      this.records.delete(mapKey);
      record.resolveCompletion({ kind: "retry" });
    }
  }

  async waitForCompletion(input: WaitInput): Promise<WaitResult> {
    const record = this.records.get(this.mapKey(input.scope, input.keyHash));
    if (!record) return { kind: "retry" };
    if (record.requestHash !== input.requestHash) return { kind: "conflict" };
    if (record.status === "COMPLETED" && record.response) {
      return {
        kind: "completed",
        response: record.response,
        expiresAt: record.expiresAt,
      };
    }

    const waitMs = Math.max(0, input.leaseExpiresAt.getTime() - Date.now());
    if (waitMs === 0) return { kind: "retry" };

    return Promise.race([
      record.completion,
      new Promise<WaitResult>((resolve) => {
        const timer = setTimeout(() => resolve({ kind: "retry" }), waitMs);
        timer.unref?.();
      }),
    ]);
  }

  async deleteExpired(now = new Date()) {
    let deleted = 0;
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now) {
        this.records.delete(key);
        record.resolveCompletion({ kind: "retry" });
        deleted += 1;
      }
    }
    return deleted;
  }

  private mapKey(scope: string, keyHash: string) {
    return `${scope}\0${keyHash}`;
  }
}

type PersistedRecord = {
  scope: string;
  keyHash: string;
  requestHash: string;
  status: string;
  ownerToken: string | null;
  responseStatus: number | null;
  responseHeaders: unknown;
  responseBody: string | null;
  expiresAt: Date;
  leaseExpiresAt: Date;
};

function parseHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function responseFromRecord(record: PersistedRecord): StoredApiResponse {
  if (record.responseStatus === null || record.responseBody === null) {
    throw new Error("Completed idempotency record has no stored response.");
  }

  return {
    status: record.responseStatus,
    headers: parseHeaders(record.responseHeaders),
    body: JSON.parse(record.responseBody) as unknown,
  };
}

export class PrismaApiIdempotencyStore implements ApiIdempotencyStore {
  async claim(input: ClaimInput): Promise<ClaimResult> {
    const { db } = await import("@/lib/db");
    const id = crypto.randomUUID();
    const rows = await db.$queryRaw<PersistedRecord[]>`
      INSERT INTO "ApiIdempotencyRecord"
        (
          "id", "scope", "keyHash", "requestHash", "status", "ownerToken",
          "responseStatus", "responseHeaders", "responseBody", "expiresAt",
          "leaseExpiresAt", "createdAt", "updatedAt"
        )
      VALUES (
        ${id}, ${input.scope}, ${input.keyHash}, ${input.requestHash},
        'PROCESSING', ${input.ownerToken}, NULL, NULL, NULL,
        ${input.expiresAt}, ${input.leaseExpiresAt}, ${input.now}, ${input.now}
      )
      ON CONFLICT ("scope", "keyHash")
      DO UPDATE SET
        "requestHash" = EXCLUDED."requestHash",
        "status" = 'PROCESSING',
        "ownerToken" = EXCLUDED."ownerToken",
        "responseStatus" = NULL,
        "responseHeaders" = NULL,
        "responseBody" = NULL,
        "expiresAt" = EXCLUDED."expiresAt",
        "leaseExpiresAt" = EXCLUDED."leaseExpiresAt",
        "updatedAt" = EXCLUDED."updatedAt"
      WHERE
        "ApiIdempotencyRecord"."expiresAt" <= ${input.now}
        OR (
          "ApiIdempotencyRecord"."status" = 'PROCESSING'
          AND "ApiIdempotencyRecord"."requestHash" = EXCLUDED."requestHash"
          AND "ApiIdempotencyRecord"."leaseExpiresAt" <= ${input.now}
        )
      RETURNING
        "scope", "keyHash", "requestHash", "status", "ownerToken",
        "responseStatus", "responseHeaders", "responseBody", "expiresAt",
        "leaseExpiresAt"
    `;

    if (rows[0]?.ownerToken === input.ownerToken) {
      return { kind: "acquired" };
    }

    const existing = await this.readRecord(input.scope, input.keyHash);
    if (!existing) {
      return this.claim(input);
    }
    if (existing.requestHash !== input.requestHash) {
      return { kind: "conflict" };
    }
    if (existing.status === "COMPLETED") {
      return {
        kind: "completed",
        response: responseFromRecord(existing),
        expiresAt: existing.expiresAt,
      };
    }
    return { kind: "processing", leaseExpiresAt: existing.leaseExpiresAt };
  }

  async complete(input: CompletionInput) {
    const { db } = await import("@/lib/db");
    const responseBody = JSON.stringify(input.response.body ?? null);
    const updated = await db.$executeRaw`
      UPDATE "ApiIdempotencyRecord"
      SET
        "status" = 'COMPLETED',
        "ownerToken" = NULL,
        "responseStatus" = ${input.response.status},
        "responseHeaders" = ${JSON.stringify(input.response.headers)}::jsonb,
        "responseBody" = ${responseBody},
        "expiresAt" = ${input.expiresAt},
        "updatedAt" = NOW()
      WHERE
        "scope" = ${input.scope}
        AND "keyHash" = ${input.keyHash}
        AND "status" = 'PROCESSING'
        AND "ownerToken" = ${input.ownerToken}
    `;

    if (updated !== 1) {
      throw new Error("The idempotency processing lease is no longer owned.");
    }
  }

  async release(input: ReleaseInput) {
    const { db } = await import("@/lib/db");
    await db.$executeRaw`
      DELETE FROM "ApiIdempotencyRecord"
      WHERE
        "scope" = ${input.scope}
        AND "keyHash" = ${input.keyHash}
        AND "status" = 'PROCESSING'
        AND "ownerToken" = ${input.ownerToken}
    `;
  }

  async waitForCompletion(input: WaitInput): Promise<WaitResult> {
    while (Date.now() < input.leaseExpiresAt.getTime()) {
      const record = await this.readRecord(input.scope, input.keyHash);
      if (!record) return { kind: "retry" };
      if (record.requestHash !== input.requestHash) return { kind: "conflict" };
      if (record.status === "COMPLETED") {
        return {
          kind: "completed",
          response: responseFromRecord(record),
          expiresAt: record.expiresAt,
        };
      }
      if (record.leaseExpiresAt.getTime() <= Date.now()) {
        return { kind: "retry" };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { kind: "retry" };
  }

  async deleteExpired(now = new Date()) {
    const { db } = await import("@/lib/db");
    return db.$executeRaw`
      DELETE FROM "ApiIdempotencyRecord"
      WHERE "expiresAt" <= ${now}
    `;
  }

  private async readRecord(scope: string, keyHash: string) {
    const { db } = await import("@/lib/db");
    const rows = await db.$queryRaw<PersistedRecord[]>`
      SELECT
        "scope", "keyHash", "requestHash", "status", "ownerToken",
        "responseStatus", "responseHeaders", "responseBody", "expiresAt",
        "leaseExpiresAt"
      FROM "ApiIdempotencyRecord"
      WHERE "scope" = ${scope} AND "keyHash" = ${keyHash}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashApiIdempotencyKey(key: string) {
  return sha256(key);
}

export function hashApiIdempotencyRequestBody(requestBody: unknown) {
  return sha256(stableJson(requestBody));
}

export function validateApiIdempotencyKey(key: string) {
  return key.length > 0 && key.length <= API_IDEMPOTENCY_KEY_MAX_LENGTH;
}

export type ApiIdempotencyReplayEvent = {
  level: "info";
  message: "API idempotency response replayed.";
  event: "api_idempotency_replay";
  outcome: "replayed";
  responseStatus: number;
  responseCode: string;
  retentionSeconds: number;
  scopePseudonym: string;
  keyPseudonym: string;
};

export function reportApiIdempotencyReplay(
  {
    scope,
    key,
    response,
    retentionMs,
    pseudonymSecret,
  }: {
    scope: string;
    key: string;
    response: StoredApiResponse;
    retentionMs: number;
    pseudonymSecret?: string;
  },
  logger: (message: string) => void = console.info,
) {
  const secret =
    pseudonymSecret?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    null;
  const pseudonym = (kind: string, value: string) =>
    secret
      ? crypto
          .createHmac("sha256", secret)
          .update(`api-idempotency\0${kind}\0${value}`)
          .digest("hex")
          .slice(0, 16)
      : "unavailable";
  const responseBody =
    response.body && typeof response.body === "object"
      ? (response.body as Record<string, unknown>)
      : null;
  const rawCode = responseBody?.code;
  const responseCode =
    typeof rawCode === "string" && /^[a-z0-9_]{1,64}$/.test(rawCode)
      ? rawCode
      : "unavailable";
  const safeRetentionMs = Number.isFinite(retentionMs)
    ? Math.max(1, Math.min(API_IDEMPOTENCY_RETENTION_MS, Math.floor(retentionMs)))
    : API_IDEMPOTENCY_RETENTION_MS;
  const event: ApiIdempotencyReplayEvent = {
    level: "info",
    message: "API idempotency response replayed.",
    event: "api_idempotency_replay",
    outcome: "replayed",
    responseStatus: Math.max(0, Math.min(999, Math.floor(response.status))),
    responseCode,
    retentionSeconds: Math.max(1, Math.ceil(safeRetentionMs / 1_000)),
    scopePseudonym: pseudonym("scope", scope),
    keyPseudonym: pseudonym("key", key),
  };

  logger(JSON.stringify(event));
  return event;
}

function responseForReplay(
  response: StoredApiResponse,
  expiresAt: Date,
  now: Date,
): StoredApiResponse {
  const headers = { ...response.headers };

  if (response.status !== 429) {
    return { ...response, headers };
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.min(
      3_600,
      Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000),
    ),
  );
  const retryAfterHeader = Object.keys(headers).find(
    (header) => header.toLowerCase() === "retry-after",
  );
  headers[retryAfterHeader ?? "retry-after"] = String(retryAfterSeconds);

  const body =
    response.body &&
    typeof response.body === "object" &&
    !Array.isArray(response.body) &&
    typeof (response.body as Record<string, unknown>).retry_after === "number"
      ? {
          ...(response.body as Record<string, unknown>),
          retry_after: retryAfterSeconds,
        }
      : response.body;

  return { ...response, headers, body };
}

export async function executeIdempotently({
  scope,
  key,
  requestBody,
  store,
  execute,
  responseRetentionMs,
  now = new Date(),
  retentionMs = API_IDEMPOTENCY_RETENTION_MS,
  processingLeaseMs = API_IDEMPOTENCY_PROCESSING_LEASE_MS,
}: {
  scope: string;
  key: string;
  requestBody: unknown;
  store: ApiIdempotencyStore;
  execute: () => Promise<StoredApiResponse>;
  responseRetentionMs?:
    | number
    | ((response: StoredApiResponse) => number);
  now?: Date;
  retentionMs?: number;
  processingLeaseMs?: number;
}): Promise<
  | { kind: "executed" | "replayed"; response: StoredApiResponse }
  | { kind: "conflict"; response?: never }
> {
  const keyHash = hashApiIdempotencyKey(key);
  const requestHash = hashApiIdempotencyRequestBody(requestBody);
  const safeRetentionMs = Number.isFinite(retentionMs)
    ? Math.max(
        1,
        Math.min(API_IDEMPOTENCY_RETENTION_MS, Math.floor(retentionMs)),
      )
    : API_IDEMPOTENCY_RETENTION_MS;

  for (;;) {
    const ownerToken = crypto.randomUUID();
    const claimStartedAt = performance.now();
    const claim = await store.claim({
      scope,
      keyHash,
      requestHash,
      ownerToken,
      now,
      expiresAt: new Date(now.getTime() + safeRetentionMs),
      leaseExpiresAt: new Date(now.getTime() + Math.max(1, processingLeaseMs)),
    });

    if (claim.kind === "conflict") return { kind: "conflict" };
    if (claim.kind === "completed") {
      return {
        kind: "replayed",
        response: responseForReplay(claim.response, claim.expiresAt, now),
      };
    }
    if (claim.kind === "processing") {
      const waited = await store.waitForCompletion({
        scope,
        keyHash,
        requestHash,
        leaseExpiresAt: claim.leaseExpiresAt,
      });
      if (waited.kind === "conflict") return { kind: "conflict" };
      if (waited.kind === "completed") {
        return {
          kind: "replayed",
          response: responseForReplay(
            waited.response,
            waited.expiresAt,
            new Date(),
          ),
        };
      }
      now = new Date();
      continue;
    }

    try {
      const response = await execute();
      const completedAt = new Date(
        now.getTime() + Math.max(0, performance.now() - claimStartedAt),
      );
      const requestedResponseRetentionMs =
        typeof responseRetentionMs === "function"
          ? responseRetentionMs(response)
          : (responseRetentionMs ?? safeRetentionMs);
      const safeResponseRetentionMs = Number.isFinite(
        requestedResponseRetentionMs,
      )
        ? Math.min(
            safeRetentionMs,
            Math.max(1, Math.floor(requestedResponseRetentionMs)),
          )
        : safeRetentionMs;
      await store.complete({
        scope,
        keyHash,
        ownerToken,
        response,
        expiresAt: new Date(completedAt.getTime() + safeResponseRetentionMs),
      });
      return { kind: "executed", response };
    } catch (error) {
      await store.release({ scope, keyHash, ownerToken }).catch(() => {});
      throw error;
    }
  }
}

export function pruneExpiredApiIdempotencyRecords(now = new Date()) {
  return new PrismaApiIdempotencyStore().deleteExpired(now);
}
