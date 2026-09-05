import { NextRequest, NextResponse } from "next/server";
import { recordTranslationContexts } from "@/lib/translation-context";
import { validateApiKey } from "@/lib/api-keys";
import { getEffectiveWordsLimit } from "@/lib/billing-plans";
import { crossedQuotaThresholds } from "@/lib/quota-usage";
import { maybeSendQuotaAlerts } from "@/lib/quota-alert";
import {
  countWords,
  resolveTranslationProvider,
  TranslationCountMismatchDeadlineError,
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
  getTranslateWordVelocityPolicy,
  reportTranslateVelocityOutcome,
  releaseTranslateWordVelocity,
} from "@/lib/rate-limit";
import { shouldRejectTranslateRequest } from "@/lib/translate-quota";
import { apiProblem, validationProblem } from "@/lib/problem-details";
import {
  API_IDEMPOTENCY_RETENTION_MS,
  PrismaApiIdempotencyStore,
  executeIdempotently,
  reportApiIdempotencyReplay,
  validateApiIdempotencyKey,
  type StoredApiResponse,
} from "@/lib/api-idempotency";
import { findOrganizationTranslationMemory } from "@/lib/translation-memory";
import { resetTranslationWorkflowAfterContentEdit } from "@/lib/translation-workflow";
import {
  assertPostgresTextFields,
  inspectPostgresText,
  reportPostgresTextRejection,
} from "@/lib/postgres-text";
import { shouldCreateFreshTranslations } from "@/lib/automatic-translation";
import {
  lockAndValidateProjectLanguageWrite,
  lockProjectRuntimeConfiguration,
} from "@/lib/project-runtime-configuration-lock";

export const runtime = "nodejs";

/**
 * Fresh translations are provider-bound work: even chunked and parallelized
 * (see `resolveTranslationChunking`) a large page takes several seconds, and a
 * failover to the next provider doubles that.
 *
 * Pinned rather than left to the platform default, which was high enough that
 * three requests in 24h burned a full 300s on a hung upstream. 120s is sized
 * from the parts: a chunk needs ~16s, `DEFAULT_PROVIDER_TIMEOUT_MS` caps one
 * provider call at 45s, and a chain is primary + fallback — so a worst-case
 * hang-then-recover still finishes here, while a runaway dies 2.5x sooner.
 */
export const maxDuration = 120;

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
 *   cache_only: boolean,       // true when uncached identities must not be persisted
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

    const rejectNul = (value: unknown, field: string, index?: number) => {
      if (typeof value !== "string") return;
      const error = inspectPostgresText(value, {
        boundary: "translate_api_input",
        field,
        ...(index === undefined ? {} : { index }),
      });
      if (!error) return;

      reportPostgresTextRejection(error);
      validationErrors[field] = [
        "NUL-Zeichen (U+0000) sind in Übersetzungstexten nicht erlaubt.",
      ];
    };

    if (Array.isArray(words)) {
      words.forEach((word, index) => {
        if (word && typeof word === "object") {
          rejectNul((word as { w?: unknown }).w, `words.${index}.w`, index);
        }
      });
    }
    rejectNul(l_from, "l_from");
    rejectNul(l_to, "l_to");
    rejectNul(request_url, "request_url");
    rejectNul(title, "title");

    if (Object.keys(validationErrors).length > 0) {
      return validationProblem({
        detail: "Der Request enthält fehlende oder ungültige Felder.",
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
    let canCreateFreshTranslations = shouldCreateFreshTranslations({
      isBot,
      automaticTranslation: project.settings?.automaticTranslation,
    });
    let providerSettings = project.settings;
    let providerName = isBot
      ? "bot"
      : canCreateFreshTranslations
        ? "cache"
        : "disabled";
    const allowedLangs = project.languages
      .filter((language) => language.isActive)
      .map((language) => language.langCode.toLowerCase());

    if (l_from.toLowerCase() !== project.originalLang.toLowerCase()) {
      return validationProblem({
        detail: `Source language '${l_from}' must match the project's original language.`,
        instance: "/api/translate",
        errors: {
          l_from: ["Source language must match the project's original language."],
        },
      });
    }

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

    // API-key validation returns a useful project snapshot, but settings can
    // change while cache/glossary work runs. Re-read immediately before any
    // quota reservation or provider call. Disabling automatic translation now
    // downgrades the request to cache-only without incurring fresh spend.
    if (pendingTranslations.length > 0 && canCreateFreshTranslations) {
      const currentRuntimeConfiguration = await db.project.findUnique({
        where: { id: project.id },
        select: {
          originalLang: true,
          languages: {
            where: { isActive: true },
            select: { langCode: true },
          },
          settings: true,
        },
      });
      const sourceLanguageStillMatches =
        currentRuntimeConfiguration?.originalLang.toLowerCase() ===
        l_from.toLowerCase();
      const targetLanguageStillActive =
        currentRuntimeConfiguration?.languages.some(
          (language) =>
            language.langCode.toLowerCase() === l_to.toLowerCase(),
        ) ?? false;
      if (!sourceLanguageStillMatches || !targetLanguageStillActive) {
        return apiProblem({
          status: 409,
          title: "Project language configuration changed",
          detail:
            "The project's source or target language changed while this request was prepared. Retry with the current runtime configuration.",
          code: "project_language_configuration_changed",
          instance: "/api/translate",
        });
      }

      providerSettings = currentRuntimeConfiguration?.settings ?? null;
      canCreateFreshTranslations = shouldCreateFreshTranslations({
        isBot,
        automaticTranslation: providerSettings?.automaticTranslation,
      });
      providerName = canCreateFreshTranslations
        ? "cache"
        : "disabled";
    }

    // 6. Check usage limits after cache/manual/glossary short-circuiting.
    // Cache hits bypass the pending-word check so an expired or past-due
    // subscription still serves already-translated content; only fresh
    // provider calls are gated. `quota_probe` is the exception: health checks
    // must fail when the monthly quota is exhausted even if the probe text is
    // already cached (meinhaushalt.at 2026-06-10). PAST_DUE/INACTIVE/CANCELED
    // are soft-capped at the FREE-tier ceiling by getEffectiveWordsLimit.
    let translatedWords = canCreateFreshTranslations
      ? pendingTranslations.reduce((sum, item) => sum + item.wordCount, 0)
      : 0;
    const subscription = project.organization.subscription;
    const wordsLimit = getEffectiveWordsLimit(subscription);
    const currentMonth = getUsageMonthKey();

    // Hoisted so the post-translation block can detect a threshold crossing
    // for the owner quota alert (#148).
    let wordsUsedThisMonth = 0;
    if (canCreateFreshTranslations && (translatedWords > 0 || quotaProbe)) {
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
    let velocityReservation: {
      organizationId: string;
      words: number;
      reservationResetAt: Date;
    } | null = null;
    if (canCreateFreshTranslations && translatedWords > 0) {
      const velocityPolicy = getTranslateWordVelocityPolicy(wordsLimit);
      const velocity = await consumeTranslateWordVelocity({
        organizationId: project.organizationId,
        words: translatedWords,
        limit: velocityPolicy.limit,
      });
      reportTranslateVelocityOutcome({
        result: velocity,
        freshWords: translatedWords,
        limitSource: velocityPolicy.source,
        actorClass: "human",
        surface: "translate_api",
        itemCount: pendingTranslations.length,
        retryProtection: req.headers.has("Idempotency-Key")
          ? "idempotency_key"
          : "none",
        organizationId: project.organizationId,
        projectId: project.id,
        requestFingerprintInput: JSON.stringify([
          l_from,
          l_to,
          request_url,
          pendingTranslations.map((item) => texts[item.index]),
        ]),
      });

      if (!velocity.allowed) {
        if (velocity.outcome === "oversize") {
          return apiProblem({
            status: 422,
            title: "Translation request too large",
            detail:
              "Diese einzelne Anfrage überschreitet das vollständige Wortgeschwindigkeitslimit und muss in kleinere Anfragen geteilt werden.",
            code: "velocity_request_too_large",
            instance: "/api/translate",
          });
        }

        if (velocity.outcome === "blocked") {
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
      }

      velocityReservation = {
        organizationId: project.organizationId,
        words: translatedWords,
        reservationResetAt: velocity.resetAt,
      };
    }

    // Establish the final dispatch boundary after quota/velocity work and
    // immediately before the provider starts. A configuration change before
    // this lock is still pre-spend and can safely refund the exact reservation;
    // once translateTexts starts, the reservation is never refunded.
    if (pendingTranslations.length > 0 && canCreateFreshTranslations) {
      const refundBeforeProvider = async () => {
        if (!velocityReservation) return;
        const reservation = velocityReservation;
        velocityReservation = null;
        try {
          await releaseTranslateWordVelocity(reservation);
        } catch (error) {
          // A failed pre-provider refund is conservative: no provider work is
          // dispatched, and retaining the reservation cannot weaken the cap.
          console.error(
            "[/api/translate] Velocity reservation refund failed:",
            error,
          );
        }
      };

      try {
        const dispatchConfiguration = await db.$transaction(async (tx) => {
          const languageConfigurationIsCurrent =
            await lockAndValidateProjectLanguageWrite(tx, {
              projectId: project.id,
              sourceLanguages: [l_from],
              targetLanguages: [l_to],
            });
          if (!languageConfigurationIsCurrent) {
            return { kind: "language_configuration_changed" } as const;
          }

          const settings = await tx.projectSettings.findUnique({
            where: { projectId: project.id },
          });
          return settings?.automaticTranslation === false
            ? ({ kind: "automatic_translation_disabled", settings } as const)
            : ({ kind: "ready", settings } as const);
        });

        if (dispatchConfiguration.kind === "language_configuration_changed") {
          await refundBeforeProvider();
          return apiProblem({
            status: 409,
            title: "Project language configuration changed",
            detail:
              "The project's source or target language changed before provider dispatch. Retry with the current runtime configuration.",
            code: "project_language_configuration_changed",
            instance: "/api/translate",
          });
        }

        providerSettings = dispatchConfiguration.settings;
        if (dispatchConfiguration.kind === "automatic_translation_disabled") {
          await refundBeforeProvider();
          canCreateFreshTranslations = false;
          providerName = "disabled";
          translatedWords = 0;
        } else {
          providerName = resolveTranslationProvider(undefined, providerSettings);
        }
      } catch (error) {
        await refundBeforeProvider();
        throw error;
      }
    }

    // 7. Translate uncached strings via the configured provider.
    if (pendingTranslations.length > 0 && canCreateFreshTranslations) {
      // From this statement onward provider cost may have been incurred. Clear
      // the only refund handle before dispatch so no later error path can undo
      // the conservative velocity charge.
      velocityReservation = null;
      const results: Awaited<ReturnType<typeof translateTexts>> =
        await translateTexts(
          {
            texts: pendingTranslations.map((item) => item.protectedText),
            sourceLang: l_from,
            targetLang: l_to,
            ...(providerSettings?.websiteType
              ? { websiteType: providerSettings.websiteType }
              : {}),
            ...(providerSettings?.industryType
              ? { industryType: providerSettings.industryType }
              : {}),
          },
          undefined,
          providerSettings,
        );

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
        const persistenceResult = await db.$transaction(
          async (tx) => {
            if (!(await lockProjectRuntimeConfiguration(tx, project.id))) {
              return { kind: "language_configuration_changed" } as const;
            }

            const currentLanguageConfiguration = await tx.project.findUnique({
              where: { id: project.id },
              select: {
                originalLang: true,
                languages: {
                  where: { isActive: true },
                  select: { langCode: true },
                },
                settings: {
                  select: { automaticTranslation: true },
                },
              },
            });
            const sourceLanguageStillMatches =
              currentLanguageConfiguration?.originalLang.toLowerCase() ===
              l_from.toLowerCase();
            const targetLanguageStillActive =
              currentLanguageConfiguration?.languages.some(
                (language) =>
                  language.langCode.toLowerCase() === l_to.toLowerCase(),
              ) ?? false;
            if (!sourceLanguageStillMatches || !targetLanguageStillActive) {
              return { kind: "language_configuration_changed" } as const;
            }
            if (
              currentLanguageConfiguration.settings?.automaticTranslation ===
              false
            ) {
              return { kind: "automatic_translation_disabled" } as const;
            }

            for (const [resultIndex, item] of pendingTranslations.entries()) {
              const translated = restoreGlossaryTerms(
                results[resultIndex].text,
                item.protection,
              );

              assertPostgresTextFields(
                {
                  originalText: texts[item.index],
                  translatedText: translated,
                  langFrom: l_from,
                  langTo: l_to,
                },
                {
                  boundary: "translation_persistence",
                  index: item.index,
                },
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

            await recordTranslationContexts(tx, {
              projectId: project.id,
              domain: project.domain,
              requestUrl: request_url,
              langFrom: l_from,
              langTo: l_to,
              hashes,
            });
            return { kind: "persisted" } as const;
          },
          {
            maxWait: 5_000,
            timeout: 30_000,
          },
        );

        if (persistenceResult.kind === "language_configuration_changed") {
          return apiProblem({
            status: 409,
            title: "Project language configuration changed",
            detail:
              "The project's source or target language changed while translation was in progress. Retry with the current runtime configuration.",
            code: "project_language_configuration_changed",
            instance: "/api/translate",
          });
        }
        if (persistenceResult.kind === "automatic_translation_disabled") {
          return apiProblem({
            status: 409,
            title: "Automatic translation disabled",
            detail:
              "Automatic translation was disabled while provider work was in progress. No translation data was stored.",
            code: "automatic_translation_disabled_during_request",
            instance: "/api/translate",
          });
        }
      } catch (error) {
        // The provider completed successfully before persistence began. Keep
        // the velocity charge even when persistence fails: the paid upstream
        // work is real, and refunding it would make retry loops bypass the
        // spend guard.
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

    if (
      !isBot &&
      (pendingTranslations.length === 0 || !canCreateFreshTranslations)
    ) {
      await db.$transaction(async (tx) => {
        const languageConfigurationIsCurrent =
          await lockAndValidateProjectLanguageWrite(tx, {
            projectId: project.id,
            sourceLanguages: [l_from],
            targetLanguages: [l_to],
          });
        if (!languageConfigurationIsCurrent) {
          // Cached translations are still safe to serve. Skip only analytics
          // whose language identity became stale while this request ran.
          return;
        }

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
        await recordTranslationContexts(tx, {
          projectId: project.id,
          domain: project.domain,
          requestUrl: request_url,
          langFrom: l_from,
          langTo: l_to,
          hashes,
        });
        await upsertTranslatedUrlHit({
          projectId: project.id,
          langTo: l_to,
          requestUrl: request_url || null,
          wordCount: totalWords,
          tx,
        });
      });
    }

    // 9. Return the drop-in-compatible response format.
    return NextResponse.json({
      l_from,
      l_to,
      request_url,
      title,
      bot,
      cache_only: !canCreateFreshTranslations,
      from_words: texts,
      to_words: translatedTexts,
    });
  } catch (error) {
    if (error instanceof TranslationCountMismatchDeadlineError) {
      return apiProblem({
        status: 503,
        title: "Translation temporarily unavailable",
        detail: error.message,
        code: "translation_count_mismatch_deadline",
        instance: "/api/translate",
      });
    }
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
const TRANSLATION_DEADLINE_IDEMPOTENCY_RETENTION_MS = 60_000;

function translateIdempotencyResponseRetentionMs(response: StoredApiResponse) {
  const responseCode =
    response.body &&
    typeof response.body === "object" &&
    !Array.isArray(response.body) &&
    typeof (response.body as { code?: unknown }).code === "string"
      ? (response.body as { code: string }).code
      : null;
  if (
    response.status === 503 &&
    responseCode === "translation_count_mismatch_deadline"
  ) {
    return TRANSLATION_DEADLINE_IDEMPOTENCY_RETENTION_MS;
  }

  if (response.status !== 429) {
    return API_IDEMPOTENCY_RETENTION_MS;
  }

  const parsedRetryAfter = Number(response.headers["retry-after"]);
  const retryAfterSeconds =
    Number.isInteger(parsedRetryAfter) && parsedRetryAfter > 0
      ? Math.min(parsedRetryAfter, 3_600)
      : 60;
  return retryAfterSeconds * 1_000;
}

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
    const idempotencyScope = `${apiKeyRecord.id}:POST:/api/translate`;
    const result = await executeIdempotently({
      scope: idempotencyScope,
      key: idempotencyKey,
      requestBody: parsedBody,
      store: translateIdempotencyStore,
      responseRetentionMs: translateIdempotencyResponseRetentionMs,
      // Retry-After bounds transient 429 replay; the classified count-mismatch
      // deadline 503 is retained for only 60 seconds rather than a full day.
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

    if (result.kind === "replayed") {
      reportApiIdempotencyReplay({
        scope: idempotencyScope,
        key: idempotencyKey,
        response: result.response,
        retentionMs: translateIdempotencyResponseRetentionMs(result.response),
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
