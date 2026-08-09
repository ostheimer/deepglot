import { randomUUID } from "node:crypto";

export const TRANSLATION_LATENCY_SEGMENT_COUNTS = [1, 12, 25, 50] as const;

type TranslationLatencyPayload = {
  l_from: "de";
  l_to: "en";
  request_url: string;
  title: string;
  bot: 0;
  words: Array<{ t: 1; w: string }>;
};

export type TranslationLatencyCase = {
  segmentCount: number;
  sources: string[];
  payload: TranslationLatencyPayload;
};

export type TranslationLatencyResponse = {
  status: number;
  durationMs: number;
  body: unknown;
};

export type TranslationLatencyResult = {
  status: "PASS" | "FAIL";
  detail: string;
  freshDurationMs: number;
  cachedDurationMs: number;
  speedup: number;
};

export function buildTranslationLatencyRunId(
  now = new Date(),
  randomSuffix = randomUUID().slice(0, 8),
) {
  const timestamp = now.toISOString().replace(/[-:.]/g, "");
  return `${timestamp}-${randomSuffix}`;
}

const ACCEPTANCE_APP_URL = "DEEPGLOT_LATENCY_ACCEPTANCE_APP_URL";
const ACCEPTANCE_API_KEY = "DEEPGLOT_LATENCY_ACCEPTANCE_API_KEY";
const CANONICAL_PRODUCTION_ORIGIN = "https://deepglot.ai";

export function resolveTranslationLatencyConfig({
  production,
  local,
  runtime,
}: {
  production: Record<string, string | undefined>;
  local: Record<string, string | undefined>;
  runtime: Record<string, string | undefined>;
}): { appUrl: string; apiKey: string; source: string } {
  const sources = [
    { values: runtime, label: "process environment" },
    { values: local, label: "local env file" },
    { values: production, label: "production env file" },
  ];

  for (const source of sources) {
    const appUrl = source.values[ACCEPTANCE_APP_URL]?.trim();
    const apiKey = source.values[ACCEPTANCE_API_KEY]?.trim();

    if (!appUrl && !apiKey) {
      continue;
    }

    if (!appUrl || !apiKey) {
      throw new Error(
        `${ACCEPTANCE_APP_URL} and ${ACCEPTANCE_API_KEY} must come from the same environment source (${source.label}).`,
      );
    }

    return {
      appUrl: validateCanonicalAcceptanceOrigin(appUrl),
      apiKey,
      source: source.label,
    };
  }

  throw new Error(
    `A dedicated latency acceptance configuration is required: set ${ACCEPTANCE_APP_URL} and ${ACCEPTANCE_API_KEY} together.`,
  );
}

export function buildTranslationLatencyCases({
  runId,
  requestOrigin,
}: {
  runId: string;
  requestOrigin: string;
}): TranslationLatencyCase[] {
  return TRANSLATION_LATENCY_SEGMENT_COUNTS.map((segmentCount) => {
    const sources = Array.from(
      { length: segmentCount },
      (_, index) =>
        `Deepglot-Latenzprüfung ${runId}, Segment ${index + 1}: Dieser frische deutsche Satz muss vollständig ins Englische übersetzt werden.`,
    );
    const requestUrl = new URL(
      `/translation-latency/${encodeURIComponent(runId)}/${segmentCount}`,
      requestOrigin,
    ).toString();

    return {
      segmentCount,
      sources,
      payload: {
        l_from: "de",
        l_to: "en",
        request_url: requestUrl,
        title: `Deepglot latency acceptance ${runId}`,
        bot: 0,
        words: sources.map((source) => ({ t: 1 as const, w: source })),
      },
    };
  });
}

export function evaluateTranslationLatencyPair({
  sources,
  fresh,
  cached,
}: {
  sources: string[];
  fresh: TranslationLatencyResponse;
  cached: TranslationLatencyResponse;
}): TranslationLatencyResult {
  const freshContract = validateTranslationResponse(sources, fresh);
  const cachedContract = validateTranslationResponse(sources, cached);
  const speedup = roundSpeedup(fresh.durationMs, cached.durationMs);
  const base = {
    freshDurationMs: fresh.durationMs,
    cachedDurationMs: cached.durationMs,
    speedup,
  };

  if (!freshContract.ok) {
    return {
      status: "FAIL",
      detail: `fresh contract invalid: ${freshContract.detail}`,
      ...base,
    };
  }

  if (!cachedContract.ok) {
    return {
      status: "FAIL",
      detail: `cached contract invalid: ${cachedContract.detail}`,
      ...base,
    };
  }

  if (!arraysEqual(freshContract.translations, cachedContract.translations)) {
    return {
      status: "FAIL",
      detail: "cached response does not match fresh translations",
      ...base,
    };
  }

  if (cached.durationMs >= fresh.durationMs) {
    return {
      status: "FAIL",
      detail: `cached response was not faster; fresh=${fresh.durationMs}ms; cached=${cached.durationMs}ms`,
      ...base,
    };
  }

  return {
    status: "PASS",
    detail: `fresh=${fresh.durationMs}ms; cached=${cached.durationMs}ms; speedup=${speedup.toFixed(2)}x; contract=complete`,
    ...base,
  };
}

function validateTranslationResponse(
  sources: string[],
  response: TranslationLatencyResponse,
): { ok: true; translations: string[] } | { ok: false; detail: string } {
  if (response.status !== 200) {
    return { ok: false, detail: `status=${response.status}` };
  }

  if (!isRecord(response.body)) {
    return { ok: false, detail: "body is not an object" };
  }

  const fromWords = response.body.from_words;
  const toWords = response.body.to_words;

  if (!Array.isArray(fromWords) || !arraysEqual(fromWords, sources)) {
    return { ok: false, detail: "from_words does not preserve source order" };
  }

  if (
    !Array.isArray(toWords) ||
    toWords.length !== sources.length ||
    !toWords.every((word) => typeof word === "string" && word.trim().length > 0)
  ) {
    return { ok: false, detail: "to_words is incomplete or contains empty values" };
  }

  const translations = toWords as string[];
  if (translations.some((translation, index) => translation === sources[index])) {
    return { ok: false, detail: "to_words contains a source identity" };
  }

  return { ok: true, translations };
}

function arraysEqual(left: unknown[], right: unknown[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function roundSpeedup(freshDurationMs: number, cachedDurationMs: number) {
  if (cachedDurationMs <= 0) {
    return freshDurationMs > 0 ? Number.POSITIVE_INFINITY : 1;
  }

  return Math.round((freshDurationMs / cachedDurationMs) * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateCanonicalAcceptanceOrigin(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${ACCEPTANCE_APP_URL} must be exactly ${CANONICAL_PRODUCTION_ORIGIN}.`,
    );
  }

  if (
    url.origin !== CANONICAL_PRODUCTION_ORIGIN ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      `${ACCEPTANCE_APP_URL} must be exactly ${CANONICAL_PRODUCTION_ORIGIN}; preview hosts, foreign hosts, URL credentials, paths, queries, and fragments are not allowed.`,
    );
  }

  return CANONICAL_PRODUCTION_ORIGIN;
}
