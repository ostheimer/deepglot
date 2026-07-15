import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api-keys";
import { getEffectiveWordsLimit } from "@/lib/billing-plans";
import { crossedQuotaThresholds } from "@/lib/quota-usage";
import { maybeSendQuotaAlerts } from "@/lib/quota-alert";
import {
  countWords,
  resolveTranslationProvider,
  translateTexts,
} from "@/lib/translation";
import { db } from "@/lib/db";
import {
  buildGlossaryProtection,
  hasGlossaryProtection,
  restoreGlossaryTerms,
} from "@/lib/glossary";
import {
  getUsageMonthKey,
  incrementUsageRecord,
  recordTranslationBatch,
  upsertTranslatedUrlHit,
} from "@/lib/translation-batches";
import { computeTranslationHash } from "@/lib/translation-hash";
import { queueProjectWebhookEvent } from "@/lib/project-webhook-delivery";
import {
  TRANSLATE_RATE_LIMIT_SCOPE,
  buildRateLimitHeaders,
  consumeRateLimit,
  consumeTranslateWordVelocity,
  getRateLimitConfig,
  getTranslateWordVelocityLimit,
  releaseTranslateWordVelocity,
} from "@/lib/rate-limit";
import { shouldRejectTranslateRequest } from "@/lib/translate-quota";
import { apiProblem, validationProblem } from "@/lib/problem-details";
import {
  PrismaApiIdempotencyStore,
  executeIdempotently,
  validateApiIdempotencyKey,
  type StoredApiResponse,
} from "@/lib/api-idempotency";
import { findOrganizationTranslationMemory } from "@/lib/translation-memory";
import { resetTranslationWorkflowAfterContentEdit } from "@/lib/translation-workflow";

export const runtime = "nodejs";

// WordType - same values as the legacy translation contract for drop-in compatibility
export const WordType = {
  OTHER: 0,
  TEXT: 1,
  VALUE: 2,
  PLACEHOLDER: 3,
  META_CONTENT: 4,
  IFRAME_SRC: 5,
  IMG_SRC: 6,
  IMG_ALT: 7,
  PDF_HREF: 8,
  PAGE_TITLE: 9,
  EXTERNAL_LINK: 10,
} as const;

// BotType - same values as the legacy translation contract
export const BotType = {
  HUMAN: 0,
  OTHER: 1,
  GOOGLE: 2,
  BING: 3,
  YAHOO: 4,
  BAIDU: 5,
  YANDEX: 6,
} as const;

/**
 * POST /api/translate?api_key=dg_live_...
 *
 * Drop-in-compatible translation endpoint.
 * Accepts both:
 *   - ?api_key=... query param (legacy client format)
 *   - Authorization: Bearer ... header (Deepglot-native)
 *
 * Request body:
 * {
 *   l_from: string,          // ISO 639-1 source language
 *   l_to: string,            // ISO 639-1 target language
 *   words: [{w: string, t: number}],
 *   request_url?: string,    // URL where request comes from (for stats)
 *   title?: string,          // Page title (for stats)
 *   bot?: number,            // BotType (0=human, 2=Google, etc.)
 *   quota_probe?: boolean,   // Health-check flag: reject when quota is exhausted even on cache hits
 * }
 *
 * Response (drop-in-compatible):
 * {
 *   l_from: string,
 *   l_to: string,
 *   request_url: string,
 *   title: string,
 *   bot: number,
 *   from_words: string[],
 *   to_words: string[],
 * }
 */
type ValidatedApiKeyRecord = NonNullable<
  Awaited<ReturnType<typeof validateApiKey>>
>;

async function executeAuthenticatedTranslateRequest(
  req: NextRequest,
  apiKeyRecord: ValidatedApiKeyRecord,
  parsedBodyOverride?: unknown,
) {
  try {
    // 2. Persistent rate limiting per API key
    const rateLimit = await consumeRateLimit({
      scope: TRANSLATE_RATE_LIMIT_SCOPE,
      subject: apiKeyRecord.id,
      limit: getRateLimitConfig().translatePerMinute,
    });

    if (!rateLimit.allowed) {
      return apiProblem({
        status: 429,
        title: "Rate limit exceeded",
        detail: `Rate Limit überschritten. Maximal ${rateLimit.limit} Anfragen pro Minute.`,
        code: "rate_limit_exceeded",
        instance: "/api/translate",
        extensions: { retry_after: rateLimit.retryAfterSeconds },
        headers: buildRateLimitHeaders(rateLimit),
      });
    }

    // 3. Parse request body
    let parsedBody = parsedBodyOverride;
    if (parsedBodyOverride === undefined) {
      try {
        parsedBody = await req.json();
      } catch {
        return validationProblem({
          detail: "Der Request-Body muss gültiges JSON enthalten.",
          instance: "/api/translate",
          errors: { body: ["Ungültiges JSON"] },
        });
      }
    }

    const body = parsedBody as {
      l_from: string;
      l_to: string;
      words: Array<{ t: number; w: string }>;
      request_url?: string;
      title?: string;
      bot?: number;
      quota_probe?: boolean;
    };

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return validationProblem({
        detail: "Der Request-Body muss ein JSON-Objekt sein.",
        instance: "/api/translate",
        errors: { body: ["JSON-Objekt erwartet"] },
      });
    }

    const {
      l_from,
      l_to,
      words,
      request_url = "",
      title = "",
      bot = 0,
      quota_probe: quotaProbe = false,
    } = body;

    const validationErrors: Record<string, string[]> = {};
    if (
      !Array.isArray(words) ||
      words.length === 0 ||
      words.some((word) => !word || typeof word.w !== "string")
    ) {
      validationErrors.words = ["Mindestens ein gültiger Texteingang ist erforderlich."];
    }
    if (typeof l_from !== "string" || !l_from.trim()) {
      validationErrors.l_from = ["Erforderlich"];
    }
    if (typeof l_to !== "string" || !l_to.trim()) {
      validationErrors.l_to = ["Erforderlich"];
    }

    if (Object.keys(validationErrors).length > 0) {
      return validationProblem({
        detail: "Pflichtfelder fehlen oder sind ungültig: words, l_from, l_to",
        instance: "/api/translate",
        errors: validationErrors,
      });
    }

    // Skip fresh provider calls (and quota) for ALL bot traffic, serving it
    // from cache only. The threshold is OTHER, not GOOGLE: BotType.OTHER (1) is
    // "generic crawler/tool", so `>= GOOGLE` wrongly billed every unnamed
    // crawler as human. Combined with the plugin previously hardcoding bot=0,
    // crawlers grinding the long-tail archive burned the whole monthly quota
    // (issue #147). Humans (0) still translate; cache hits are served below
    // regardless, so bots keep getting already-translated content.
    const isBot = bot >= BotType.OTHER;

    // 4. Validate target language
    const project = apiKeyRecord.project;
    const providerName = isBot
      ? "bot"
      : resolveTranslationProvider(undefined, project.settings);
    const allowedLangs = project.languages.map((l) => l.langCode.toLowerCase());

    if (!allowedLangs.includes(l_to.toLowerCase())) {
      return validationProblem({
        detail: `Sprache '${l_to}' ist für dieses Projekt nicht aktiviert`,
        instance: "/api/translate",
        errors: { l_to: ["Sprache ist für dieses Projekt nicht aktiviert."] },
      });
    }

    // 5. Cache lookup and glossary protection
    const texts = words.map((w) => w.w);
    const translatedTexts: string[] = new Array(texts.length);
    const glossaryRules = await db.glossaryRule.findMany({
      where: {
        projectId: project.id,
        langFrom: l_from,
        langTo: l_to,
      },
      orderBy: [{ originalTerm: "desc" }, { updatedAt: "desc" }],
    });
    const hashes = texts.map((text) =>
      text?.trim() ? computeTranslationHash(text, l_from, l_to) : "",
    );
    const cachedTranslations = await db.translation.findMany({
      where: {
        projectId: project.id,
        originalHash: { in: hashes.filter(Boolean) },
      },
    });
    const cachedByHash = new Map(
      cachedTranslations.map((translation) => [
        translation.originalHash,
        translation,
      ]),
    );
    const translationMemoryByHash = project.settings?.translationMemory
      ? await findOrganizationTranslationMemory(db, {
          organizationId: project.organizationId,
          targetProjectId: project.id,
          originalHashes: hashes.filter(Boolean),
          langFrom: l_from,
          langTo: l_to,
        })
      : new Map();

    const pendingTranslations: Array<{
      index: number;
      hash: string;
      wordCount: number;
      protection: ReturnType<typeof buildGlossaryProtection>;
      protectedText: string;
    }> = [];

    let totalWords = 0;
    let cachedWords = 0;
    let manualWords = 0;
    let glossaryWords = 0;

    for (let index = 0; index < texts.length; index += 1) {
      const text = texts[index];

      if (!text?.trim()) {
        translatedTexts[index] = text;
        continue;
      }

      const wordCount = countWords(text);
      totalWords += wordCount;

      const protection = buildGlossaryProtection(text, glossaryRules);
      if (hasGlossaryProtection(protection)) {
        glossaryWords += protection.glossaryWords;
      }

      const hash = hashes[index];
      const cached = cachedByHash.get(hash);
      const glossaryInvalidatesCache =
        cached &&
        !cached.isManual &&
        protection.latestRuleUpdatedAt &&
        cached.updatedAt < protection.latestRuleUpdatedAt;

      if (cached && !glossaryInvalidatesCache) {
        translatedTexts[index] = cached.translatedText;
        if (cached.isManual) {
          manualWords += wordCount;
        } else {
          cachedWords += wordCount;
        }
        continue;
      }

      const memoryHit = translationMemoryByHash.get(hash);
      if (memoryHit) {
        translatedTexts[index] = memoryHit.translatedText;
        manualWords += wordCount;
        continue;
      }

      pendingTranslations.push({
        index,
        hash,
        wordCount,
        protection,
        protectedText: hasGlossaryProtection(protection)
          ? protection.protectedText
          : text,
      });
    }

    // 6. Check usage limits after cache/manual/glossary short-circuiting.
    // Cache hits bypass the pending-word check so an expired or past-due
    // subscription still serves already-translated content; only fresh
    // provider calls are gated. `quota_probe` is the exception: health checks
    // must fail when the monthly quota is exhausted even if the probe text is
    // already cached (meinhaushalt.at 2026-06-10). PAST_DUE/INACTIVE/CANCELED
    // are soft-capped at the FREE-tier ceiling by getEffectiveWordsLimit.
    const translatedWords = pendingTranslations.reduce(
      (sum, item) => sum + item.wordCount,
      0,
    );
    const subscription = project.organization.subscription;
    const wordsLimit = getEffectiveWordsLimit(subscription);
    const currentMonth = getUsageMonthKey();

    // Hoisted so the post-translation block can detect a threshold crossing
    // for the owner quota alert (#148).
    let wordsUsedThisMonth = 0;
    if (!isBot && (translatedWords > 0 || quotaProbe)) {
      const usageAggregate = await db.usageRecord.aggregate({
        where: { organizationId: project.organizationId, month: currentMonth },
        _sum: { words: true },
      });

      wordsUsedThisMonth = usageAggregate._sum.words ?? 0;

      if (
        shouldRejectTranslateRequest({
          wordsUsed: wordsUsedThisMonth,
          wordsLimit,
          pendingWordCount: translatedWords,
          quotaProbe,
        })
      ) {
        if (translatedWords > 0) {
          // Quota is effectively reached: this batch is rejected before it can
          // increment usage, so usage rarely crosses 100% by increment — the 402
          // itself is the "reached" signal. Alert the org owner once (#148).
          await maybeSendQuotaAlerts({
            organizationId: project.organizationId,
            organizationName: project.organization.name,
            month: currentMonth,
            thresholds: [100],
            wordsUsed: wordsUsedThisMonth,
            wordsLimit,
            signal: AbortSignal.timeout(5_000),
          });
        }

        return apiProblem({
          status: 402,
          title: "Quota exhausted",
          detail: "Monatliches Wortlimit erreicht",
          code: "quota_exhausted",
          instance: "/api/translate",
          extensions: {
            used: wordsUsedThisMonth,
            limit: wordsLimit,
          },
        });
      }
    }

    // 6b. Per-org fresh-word velocity limit (#203). The monthly quota caps the
    // total; this caps the RATE of fresh, provider-billed spend over a fixed
    // window, atomically. It is the authoritative bound the WordPress plugin's
    // soft per-IP caps (v0.8.4) cannot provide: a distributed attacker rotating
    // IPs through the dynamic-translate proxy still funnels through this org's
    // API keys, so a per-ORG atomic cap stops them from draining the monthly
    // quota (which is itself per-org) in minutes — keying per project would let
    // an org with N sites drain N× the rate against one shared pool.
    //
    // Charged for EVERY fresh (uncached) spend: cache hits and bots are exempt
    // (translatedWords is 0 / the block is skipped), but `quota_probe` is NOT
    // exempt — it is an attacker-settable body flag and the spend/usage block
    // below does not honor it, so exempting velocity here would let
    // `quota_probe: true` bypass the limit at full spend.
    let velocityReservation: { organizationId: string; words: number } | null =
      null;
    if (!isBot && translatedWords > 0) {
      const velocity = await consumeTranslateWordVelocity({
        organizationId: project.organizationId,
        words: translatedWords,
        limit: getTranslateWordVelocityLimit(wordsLimit),
      });

      if (!velocity.allowed) {
        return apiProblem({
          status: 429,
          title: "Translation velocity limited",
          detail:
            "Übersetzungs-Geschwindigkeitslimit erreicht. Bitte in Kürze erneut versuchen.",
          code: "velocity_limited",
          instance: "/api/translate",
          extensions: { retry_after: velocity.retryAfterSeconds },
          headers: buildRateLimitHeaders(velocity),
        });
      }

      velocityReservation = {
        organizationId: project.organizationId,
        words: translatedWords,
      };
    }

    // 7. Translate uncached strings via the configured provider.
    if (pendingTranslations.length > 0 && !isBot) {
      let results: Awaited<ReturnType<typeof translateTexts>>;
      try {
        results = await translateTexts(
          {
            texts: pendingTranslations.map((item) => item.protectedText),
            sourceLang: l_from,
            targetLang: l_to,
          },
          undefined,
          project.settings,
        );
      } catch (error) {
        if (velocityReservation) {
          try {
            await releaseTranslateWordVelocity(velocityReservation);
          } catch (refundError) {
            console.error(
              "[/api/translate] Velocity refund failed:",
              refundError,
            );
          }
        }

        throw error;
      }

      const enabledTranslationWebhookEvents = await db.webhookEndpoint.findMany(
        {
          where: {
            projectId: project.id,
            enabled: true,
            eventTypes: {
              hasSome: ["translation.created", "translation.updated"],
            },
          },
          select: { eventTypes: true },
        },
      );
      const enabledTranslationWebhookEventTypes = new Set(
        enabledTranslationWebhookEvents.flatMap(
          (endpoint) => endpoint.eventTypes,
        ),
      );
      const hashesWrittenInTransaction = new Set<string>();

      try {
        await db.$transaction(
          async (tx) => {
            for (const [resultIndex, item] of pendingTranslations.entries()) {
              const translated = restoreGlossaryTerms(
                results[resultIndex].text,
                item.protection,
              );

              translatedTexts[item.index] = translated;

              const existedBefore =
                cachedByHash.has(item.hash) ||
                hashesWrittenInTransaction.has(item.hash);
              const existingTranslation = cachedByHash.get(item.hash);
              const saved = await tx.translation.upsert({
                where: {
                  projectId_originalHash: {
                    projectId: project.id,
                    originalHash: item.hash,
                  },
                },
                create: {
                  projectId: project.id,
                  originalHash: item.hash,
                  originalText: texts[item.index],
                  translatedText: translated,
                  langFrom: l_from,
                  langTo: l_to,
                  wordCount: item.wordCount,
                  source:
                    providerName === "deepl"
                      ? "DEEPL"
                      : providerName === "mock"
                        ? "MOCK"
                        : "OPENAI",
                },
                update: {
                  translatedText: translated,
                  updatedAt: new Date(),
                  wordCount: item.wordCount,
                  isManual: false,
                  source:
                    providerName === "deepl"
                      ? "DEEPL"
                      : providerName === "mock"
                        ? "MOCK"
                        : "OPENAI",
                  ...(existingTranslation
                    ? resetTranslationWorkflowAfterContentEdit({
                        workflowStatus: existingTranslation.workflowStatus,
                        assignedToId: existingTranslation.assignedToId,
                      })
                    : {}),
                },
              });
              hashesWrittenInTransaction.add(item.hash);

              const eventType = existedBefore
                ? "translation.updated"
                : "translation.created";

              if (enabledTranslationWebhookEventTypes.has(eventType)) {
                await queueProjectWebhookEvent(
                  {
                    projectId: project.id,
                    eventType,
                    payload: {
                      type: eventType,
                      translationId: saved.id,
                      originalText: saved.originalText,
                      translatedText: saved.translatedText,
                      langFrom: saved.langFrom,
                      langTo: saved.langTo,
                      requestUrl: request_url || null,
                    },
                  },
                  tx,
                );
              }
            }

            await incrementUsageRecord({
              organizationId: project.organizationId,
              projectId: project.id,
              words: translatedWords,
              month: currentMonth,
              tx,
            });

            await recordTranslationBatch(
              {
                organizationId: project.organizationId,
                projectId: project.id,
                langFrom: l_from,
                langTo: l_to,
                requestUrl: request_url || null,
                provider: providerName,
                totalWords,
                cachedWords,
                manualWords,
                glossaryWords,
                translatedWords,
              },
              tx,
            );

            await upsertTranslatedUrlHit({
              projectId: project.id,
              langTo: l_to,
              requestUrl: request_url || null,
              wordCount: totalWords,
              tx,
            });
          },
          {
            maxWait: 5_000,
            timeout: 30_000,
          },
        );
      } catch (error) {
        if (velocityReservation) {
          try {
            await releaseTranslateWordVelocity(velocityReservation);
          } catch (refundError) {
            console.error(
              "[/api/translate] Velocity refund failed after persistence error:",
              refundError,
            );
          }
        }

        throw error;
      }

      // The increment just applied may have crossed the 90% warning line —
      // alert the org owner once (#148). A no-op (no DB/email) unless a
      // threshold was actually crossed by this request.
      await maybeSendQuotaAlerts({
        organizationId: project.organizationId,
        organizationName: project.organization.name,
        month: currentMonth,
        thresholds: crossedQuotaThresholds(
          wordsUsedThisMonth,
          wordsUsedThisMonth + translatedWords,
          wordsLimit,
        ),
        wordsUsed: wordsUsedThisMonth + translatedWords,
        wordsLimit,
        signal: AbortSignal.timeout(5_000),
      });
    }

    // 8. Fallback for bots or empty untranslated strings.
    pendingTranslations.forEach((item) => {
      if (!translatedTexts[item.index]) {
        translatedTexts[item.index] = texts[item.index];
      }
    });

    if (!isBot && pendingTranslations.length === 0) {
      await Promise.all([
        recordTranslationBatch({
          organizationId: project.organizationId,
          projectId: project.id,
          langFrom: l_from,
          langTo: l_to,
          requestUrl: request_url || null,
          provider: providerName,
          totalWords,
          cachedWords,
          manualWords,
          glossaryWords,
          translatedWords,
        }),
        upsertTranslatedUrlHit({
          projectId: project.id,
          langTo: l_to,
          requestUrl: request_url || null,
          wordCount: totalWords,
        }),
      ]);
    }

    // 9. Return the drop-in-compatible response format.
    return NextResponse.json({
      l_from,
      l_to,
      request_url,
      title,
      bot,
      from_words: texts,
      to_words: translatedTexts,
    });
  } catch (error) {
    console.error("[/api/translate] Fehler:", error);
    return apiProblem({
      status: 500,
      title: "Internal server error",
      detail: "Interner Server-Fehler",
      code: "internal_error",
      instance: "/api/translate",
    });
  }
}

const translateIdempotencyStore = new PrismaApiIdempotencyStore();

async function captureApiResponse(response: NextResponse): Promise<StoredApiResponse> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  let body: unknown = text;

  if (contentType.includes("json")) {
    body = text ? (JSON.parse(text) as unknown) : null;
  }

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  };
}

function restoreApiResponse(response: StoredApiResponse) {
  const headers = new Headers(response.headers);
  const contentType = headers.get("content-type") ?? "";
  const body =
    response.body === null
      ? null
      : contentType.includes("json")
        ? JSON.stringify(response.body)
        : typeof response.body === "string"
          ? response.body
          : JSON.stringify(response.body);

  return new NextResponse(body, { status: response.status, headers });
}

export async function POST(req: NextRequest) {
  try {
    // 1. Extract API key – support both query param AND Bearer header.
    const { searchParams } = new URL(req.url);
    const queryApiKey = searchParams.get("api_key");
    const authHeader = req.headers.get("Authorization");
    const bearerKey = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : null;
    const rawKey = queryApiKey ?? bearerKey;

    if (!rawKey) {
      return apiProblem({
        status: 401,
        title: "Authentication required",
        detail:
          "API-Key fehlt. Nutze ?api_key=dg_live_... oder Authorization: Bearer ...",
        code: "missing_api_key",
        instance: "/api/translate",
      });
    }

    const apiKeyRecord = await validateApiKey(rawKey);
    if (!apiKeyRecord) {
      return apiProblem({
        status: 401,
        title: "Authentication failed",
        detail: "Ungültiger oder abgelaufener API-Key",
        code: "invalid_api_key",
        instance: "/api/translate",
      });
    }

    const rawIdempotencyKey = req.headers.get("Idempotency-Key");
    if (rawIdempotencyKey === null) {
      return executeAuthenticatedTranslateRequest(req, apiKeyRecord);
    }

    const idempotencyKey = rawIdempotencyKey.trim();
    if (!validateApiIdempotencyKey(idempotencyKey)) {
      return validationProblem({
        detail: "Idempotency-Key muss zwischen 1 und 255 Zeichen lang sein.",
        instance: "/api/translate",
        errors: {
          "Idempotency-Key": ["Zwischen 1 und 255 Zeichen erforderlich."],
        },
      });
    }

    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return validationProblem({
        detail: "Der Request-Body muss gültiges JSON enthalten.",
        instance: "/api/translate",
        errors: { body: ["Ungültiges JSON"] },
      });
    }

    // The atomic claim happens before request rate limits, cache analytics,
    // quota/velocity reservations, provider calls, usage, or webhooks. Only the
    // winning request executes that complete side-effect pipeline.
    const result = await executeIdempotently({
      scope: `${apiKeyRecord.id}:POST:/api/translate`,
      key: idempotencyKey,
      requestBody: parsedBody,
      store: translateIdempotencyStore,
      execute: async () =>
        captureApiResponse(
          await executeAuthenticatedTranslateRequest(
            req,
            apiKeyRecord,
            parsedBody,
          ),
        ),
    });

    if (result.kind === "conflict") {
      return apiProblem({
        status: 409,
        title: "Idempotency conflict",
        detail:
          "Dieser Idempotency-Key wurde bereits mit einem anderen Request-Body verwendet.",
        code: "idempotency_conflict",
        instance: "/api/translate",
      });
    }

    return restoreApiResponse(result.response);
  } catch (error) {
    console.error("[/api/translate] Idempotency/Authentifizierung fehlgeschlagen:", error);
    return apiProblem({
      status: 500,
      title: "Internal server error",
      detail: "Interner Server-Fehler",
      code: "internal_error",
      instance: "/api/translate",
    });
  }
}
