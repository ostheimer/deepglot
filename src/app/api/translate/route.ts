import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api-keys";
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

// In-memory rate limiter (replace with Redis/Upstash in production)
const requestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const WINDOW_MS = 60_000;

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
export async function POST(req: NextRequest) {
  try {
    // 1. Extract API key – support both query param AND Bearer header
    const { searchParams } = new URL(req.url);
    const queryApiKey = searchParams.get("api_key");
    const authHeader = req.headers.get("Authorization");
    const bearerKey = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : null;

    const rawKey = queryApiKey ?? bearerKey;

    if (!rawKey) {
      return NextResponse.json(
        {
          error:
            "API-Key fehlt. Nutze ?api_key=dg_live_... oder Authorization: Bearer ...",
        },
        { status: 401 },
      );
    }

    const apiKeyRecord = await validateApiKey(rawKey);
    if (!apiKeyRecord) {
      return NextResponse.json(
        { error: "Ungültiger oder abgelaufener API-Key" },
        { status: 401 },
      );
    }

    // 2. Rate limiting per API key
    const now = Date.now();
    const rateKey = apiKeyRecord.id;
    const current = requestCounts.get(rateKey);

    if (current && now < current.resetAt) {
      if (current.count >= RATE_LIMIT) {
        return NextResponse.json(
          {
            error: "Rate Limit überschritten. Maximal 60 Anfragen pro Minute.",
          },
          { status: 429 },
        );
      }
      current.count++;
    } else {
      requestCounts.set(rateKey, { count: 1, resetAt: now + WINDOW_MS });
    }

    // 3. Parse request body
    const body = (await req.json()) as {
      l_from: string;
      l_to: string;
      words: Array<{ t: number; w: string }>;
      request_url?: string;
      title?: string;
      bot?: number;
    };

    const { l_from, l_to, words, request_url = "", title = "", bot = 0 } = body;

    if (!words?.length || !l_from || !l_to) {
      return NextResponse.json(
        { error: "Pflichtfelder fehlen: words, l_from, l_to" },
        { status: 400 },
      );
    }

    // Skip translation for bots (except human and unknown)
    // This matches the legacy client behavior - still cache but skip external translation for bots
    const isBot = bot >= BotType.GOOGLE;
    const providerName = isBot ? "bot" : resolveTranslationProvider();

    // 4. Validate target language
    const project = apiKeyRecord.project;
    const allowedLangs = project.languages.map((l) => l.langCode.toLowerCase());

    if (!allowedLangs.includes(l_to.toLowerCase())) {
      return NextResponse.json(
        { error: `Sprache '${l_to}' ist für dieses Projekt nicht aktiviert` },
        { status: 400 },
      );
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
    const translatedWords = pendingTranslations.reduce(
      (sum, item) => sum + item.wordCount,
      0,
    );
    const subscription = project.organization.subscription;
    const wordsLimit = subscription?.wordsLimit ?? 10_000;
    const currentMonth = getUsageMonthKey();

    if (!isBot && translatedWords > 0) {
      const usageAggregate = await db.usageRecord.aggregate({
        where: { organizationId: project.organizationId, month: currentMonth },
        _sum: { words: true },
      });

      const wordsUsed = usageAggregate._sum.words ?? 0;

      if (wordsUsed + translatedWords > wordsLimit) {
        return NextResponse.json(
          {
            error: "Monatliches Wortlimit erreicht",
            used: wordsUsed,
            limit: wordsLimit,
          },
          { status: 402 },
        );
      }
    }

    // 7. Translate uncached strings via the configured provider.
    if (pendingTranslations.length > 0 && !isBot) {
      const results = await translateTexts({
        texts: pendingTranslations.map((item) => item.protectedText),
        sourceLang: l_from,
        targetLang: l_to,
      });

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
    return NextResponse.json(
      { error: "Interner Server-Fehler" },
      { status: 500 },
    );
  }
}
