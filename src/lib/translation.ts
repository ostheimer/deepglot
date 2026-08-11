import { translateWithDeepL } from "@/lib/deepl";
import { translateWithGemini } from "@/lib/gemini";
import { translateWithOpenAICompatible } from "@/lib/openai";
import {
  buildFallbackProviderChain,
  resolveTranslationProviderConfig,
  validateTranslationProviderConfig,
  type TranslationProviderConfig,
  type TranslationSettingsLike,
} from "@/lib/translation-config";
import {
  TranslationProviderCountMismatchError,
  TranslationProviderResponseError,
  providerAbortSignal,
  type TranslateTextsInput,
  type TranslationEnv,
  type TranslationProviderName,
  type TranslationResult,
} from "@/lib/translation-types";
import {
  inspectPostgresText,
  reportPostgresTextRejection,
} from "@/lib/postgres-text";
export { countWords } from "@/lib/translation-types";
export {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  resolveProviderTimeoutMs,
} from "@/lib/translation-types";

function translateWithMock({
  texts,
  sourceLang,
  targetLang,
}: TranslateTextsInput): TranslationResult[] {
  return texts.map((text) => {
    if (!text.trim() || sourceLang.toLowerCase() === targetLang.toLowerCase()) {
      return {
        detectedSourceLanguage: sourceLang.toUpperCase(),
        text,
      };
    }

    return {
      detectedSourceLanguage: sourceLang.toUpperCase(),
      text: `[${targetLang.toLowerCase()}] ${text}`,
    };
  });
}

export function resolveTranslationProvider(
  env: TranslationEnv = process.env,
  settings?: TranslationSettingsLike | null
): TranslationProviderName {
  return resolveTranslationProviderConfig({ settings, env }).provider;
}

async function translateWithProvider(
  input: TranslateTextsInput,
  env: TranslationEnv,
  config: TranslationProviderConfig
): Promise<TranslationResult[]> {
  // Per attempt, not per chain: a slow primary must not eat the fallback's
  // budget before it has even been tried.
  const signal = providerAbortSignal(env);

  switch (config.provider) {
    case "openai":
    case "openrouter":
    case "ollama":
    case "openai-compatible":
      return translateWithOpenAICompatible(input, config, signal);
    case "gemini":
      return translateWithGemini(input, config, signal);
    case "deepl":
      validateTranslationProviderConfig(config);
      return translateWithDeepL(input, { ...env, DEEPL_API_KEY: config.apiKey }, signal);
    case "mock":
      return translateWithMock(input);
    default:
      throw new Error(`Provider '${config.provider}' is not supported.`);
  }
}

/**
 * Errors the fallback wrapper treats as "try the next provider": invalid
 * provider response contracts, quota / rate-limit responses, gateway/timeout
 * errors and catch-all 5xx server errors. Auth failures, local configuration
 * errors and other 4xx codes are surfaced unchanged so the operator can see
 * the real misconfiguration.
 */
const RETRYABLE_TRANSPORT_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

function isProviderFailoverError(error: unknown): boolean {
  if (error instanceof TranslationProviderResponseError) return true;
  if (!(error instanceof Error)) return false;

  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return true;
  }

  let cause: unknown = (error as Error & { cause?: unknown }).cause;
  for (let depth = 0; cause && depth < 3; depth += 1) {
    if (typeof cause !== "object") break;

    const code = (cause as { code?: unknown }).code;
    if (
      typeof code === "string" &&
      RETRYABLE_TRANSPORT_ERROR_CODES.has(code.toUpperCase())
    ) {
      return true;
    }

    if (cause instanceof Error) {
      if (cause.name === "AbortError" || cause.name === "TimeoutError") {
        return true;
      }
      cause = (cause as Error & { cause?: unknown }).cause;
      continue;
    }
    break;
  }

  const message = error.message.toLowerCase();
  if (
    message.includes("408") ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("quota")
  ) {
    return true;
  }
  if (/(\b5\d\d\b)/.test(message)) return true;
  if (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("network")
  ) {
    return true;
  }
  return false;
}

/**
 * Upper bound on how much of an upstream provider error we copy into a log
 * line. Provider errors embed the raw API response body (see openai.ts /
 * gemini.ts), so they can be long — but truncating to a too-small window
 * (the previous limit was 120 chars) hid the HTTP status and detail that make
 * an outage diagnosable. 500 keeps the status + reason without dumping an
 * entire response envelope into the logs.
 */
const PROVIDER_ERROR_LOG_LIMIT = 500;

function describeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > PROVIDER_ERROR_LOG_LIMIT
    ? `${message.slice(0, PROVIDER_ERROR_LOG_LIMIT)}...`
    : message;
}

/**
 * Every text of a request used to go into a single chat completion, so the
 * response time scaled with the total output-token count and pushed cold
 * WordPress pages (100–160 segments) past the plugin's request timeout — the
 * client gave up, the page fell back to source language and the work was
 * wasted.
 *
 * Splitting the batch into chunks that run concurrently makes the latency
 * track the *slowest chunk* instead of the whole page. It also keeps each
 * completion short enough that the strict `translations` array contract in the
 * provider adapters stays reliable on large pages.
 *
 * Sizing comes from a measurement against production on 2026-08-03, taken from
 * the jobspot.at webserver, with each size sent twice so a full SaaS cache hit
 * isolates the fixed cost:
 *
 *     segments   fresh   cached   provider
 *            1   10.4s     1.4s       9.0s
 *           12   20.1s     1.4s      18.7s
 *           25   31.7s     1.3s      30.4s
 *           50   40.5s     1.4s      39.1s
 *
 * So the request's own work is only ~1.4s; the provider costs ~9s before it
 * translates anything, plus ~0.9s per segment. Chunks below roughly 8 segments
 * therefore buy almost nothing (the fixed 9s dominates) while multiplying the
 * number of provider calls, so 8 is the point where the curve flattens.
 */
export const DEFAULT_TRANSLATION_CHUNK_SIZE = 8;

/**
 * Upper bound on concurrent provider calls per request. High enough that a
 * typical page finishes in a single wave, low enough to stay clear of provider
 * rate limits — a 429 would push the whole chunk onto the fallback provider.
 */
export const DEFAULT_TRANSLATION_CHUNK_CONCURRENCY = 12;

/**
 * A count mismatch may be shape-dependent, so retry a failed multi-text chunk
 * as smaller halves. Three levels fully isolate the default eight-text chunk,
 * while capping one configured chunk at 15 provider-chain runs even when an
 * operator raises TRANSLATION_CHUNK_SIZE far above the default.
 */
const MAX_COUNT_MISMATCH_ISOLATION_DEPTH = 3;

function positiveIntSetting(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveTranslationChunking(
  env: TranslationEnv = process.env
): { size: number; concurrency: number } {
  return {
    size: positiveIntSetting(
      env.TRANSLATION_CHUNK_SIZE,
      DEFAULT_TRANSLATION_CHUNK_SIZE
    ),
    concurrency: positiveIntSetting(
      env.TRANSLATION_CHUNK_CONCURRENCY,
      DEFAULT_TRANSLATION_CHUNK_CONCURRENCY
    ),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

/**
 * Runs `worker` over `items` with at most `limit` in flight, preserving input
 * order in the result. The first rejection propagates — a partially translated
 * batch would be silently wrong, so the caller must see the failure.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;

  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (!failed) {
        const index = cursor++;
        if (index >= items.length) return;

        try {
          results[index] = await worker(items[index], index);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    }
  );

  await Promise.all(runners);

  return results;
}

export async function translateTexts(
  input: TranslateTextsInput,
  env: TranslationEnv = process.env,
  settings?: TranslationSettingsLike | null
): Promise<TranslationResult[]> {
  if (input.texts.length === 0) {
    return [];
  }

  const primary = resolveTranslationProviderConfig({ settings, env });
  const chain = buildFallbackProviderChain(primary, env);
  const { size, concurrency } = resolveTranslationChunking(env);
  const chunks = chunk(input.texts, size);

  const translatedChunks = await mapWithConcurrency(
    chunks,
    concurrency,
    (texts) => translateChunk({ ...input, texts }, env, chain)
  );

  return translatedChunks.flat();
}

async function translateChunk(
  input: TranslateTextsInput,
  env: TranslationEnv,
  chain: TranslationProviderConfig[],
  isolationDepth = 0
): Promise<TranslationResult[]> {
  const providerChain = chain.map((entry) => entry.provider).join(" -> ");

  let lastError: unknown = null;
  let everyAttemptWasCountMismatch = true;
  for (let index = 0; index < chain.length; index += 1) {
    const candidate = chain[index];
    try {
      const results = await translateWithProvider(input, env, candidate);
      for (const [resultIndex, result] of results.entries()) {
        const nulError = inspectPostgresText(result.text, {
          boundary: "translation_provider_output",
          field: "text",
          index: resultIndex,
          provider: candidate.provider,
        });
        if (nulError) {
          reportPostgresTextRejection(nulError);
          throw new TranslationProviderResponseError(
            `${candidate.provider} returned U+0000 in translation ${resultIndex + 1}.`,
          );
        }
      }
      return results;
    } catch (error) {
      lastError = error;
      const isCountMismatch =
        error instanceof TranslationProviderCountMismatchError;
      everyAttemptWasCountMismatch &&= isCountMismatch;
      const hasNext = index < chain.length - 1;

      // Recoverable provider response / quota / rate-limit / 5xx / network
      // error with another provider still to try: warn rather than error — the
      // request can still succeed via the fallback — but log the full upstream
      // detail and the chain so a recurring failover is visible.
      if (hasNext && isProviderFailoverError(error)) {
        // Count mismatches are expected while an already-isolated child is
        // narrowed further. Logging every internal node would amplify a
        // single upstream contract failure; the root attempt still records
        // the provider failover and a privacy-safe isolation summary.
        if (!isCountMismatch || isolationDepth === 0) {
          console.warn(
            `[translation] provider ${candidate.provider} failed; falling back to ${chain[index + 1].provider} (chain: ${providerChain}). ${describeProviderError(error)}`
          );
        }
        continue;
      }

      if (
        !hasNext &&
        everyAttemptWasCountMismatch &&
        input.texts.length > 1 &&
        isolationDepth < MAX_COUNT_MISMATCH_ISOLATION_DEPTH
      ) {
        if (isolationDepth === 0) {
          console.warn(
            `[translation] isolating provider count mismatch after exhausting chain ${providerChain} (batch size: ${input.texts.length}).`
          );
        }

        const midpoint = Math.ceil(input.texts.length / 2);
        const left = await translateChunk(
          { ...input, texts: input.texts.slice(0, midpoint) },
          env,
          chain,
          isolationDepth + 1
        );
        const right = await translateChunk(
          { ...input, texts: input.texts.slice(midpoint) },
          env,
          chain,
          isolationDepth + 1
        );
        return [...left, ...right];
      }

      // Terminal failure: either the last provider in the chain failed, or the
      // error is one we deliberately surface to the operator (auth / bad
      // request). This is what the caller turns into a 5xx, so log it at error
      // level with the failing provider, the full message and the attempted
      // chain — the previous code logged nothing here and left only the route's
      // generic "[/api/translate] Fehler" line.
      console.error(
        `[translation] translation failed via ${candidate.provider}${
          hasNext ? " (non-failover error, not retrying)" : " (last provider in chain)"
        } (chain: ${providerChain}). ${describeProviderError(error)}`
      );
      throw error;
    }
  }

  // Unreachable: the chain always contains at least the primary provider.
  console.error(
    `[translation] pipeline produced no result (chain: ${providerChain}).`
  );
  throw lastError instanceof Error
    ? lastError
    : new Error("Translation pipeline produced no result");
}
