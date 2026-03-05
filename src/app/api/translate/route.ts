import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api-keys";
import { translateTexts, countWords } from "@/lib/deepl";
import { db } from "@/lib/db";
import crypto from "crypto";

export const runtime = "nodejs";

// WordType – same values as Weglot for drop-in compatibility
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

// BotType – same values as Weglot
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
 * Weglot-compatible translation endpoint.
 * Accepts both:
 *   - ?api_key=... query param (Weglot-style)
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
 * Response (Weglot-compatible):
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
    const bearerKey = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    const rawKey = queryApiKey ?? bearerKey;

    if (!rawKey) {
      return NextResponse.json(
        { error: "API-Key fehlt. Nutze ?api_key=dg_live_... oder Authorization: Bearer ..." },
        { status: 401 }
      );
    }

    const apiKeyRecord = await validateApiKey(rawKey);
    if (!apiKeyRecord) {
      return NextResponse.json(
        { error: "Ungültiger oder abgelaufener API-Key" },
        { status: 401 }
      );
    }

    // 2. Rate limiting per API key
    const now = Date.now();
    const rateKey = apiKeyRecord.id;
    const current = requestCounts.get(rateKey);

    if (current && now < current.resetAt) {
      if (current.count >= RATE_LIMIT) {
        return NextResponse.json(
          { error: "Rate Limit überschritten. Maximal 60 Anfragen pro Minute." },
          { status: 429 }
        );
      }
      current.count++;
    } else {
      requestCounts.set(rateKey, { count: 1, resetAt: now + WINDOW_MS });
    }

    // 3. Parse request body
    const body = await req.json() as {
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
        { status: 400 }
      );
    }

    // Skip translation for bots (except human and unknown)
    // This matches Weglot's behavior – still cache but skip DeepL for bots
    const isBot = bot >= BotType.GOOGLE;

    // 4. Validate target language
    const project = apiKeyRecord.project;
    const allowedLangs = project.languages.map((l) => l.langCode.toLowerCase());

    if (!allowedLangs.includes(l_to.toLowerCase())) {
      return NextResponse.json(
        { error: `Sprache '${l_to}' ist für dieses Projekt nicht aktiviert` },
        { status: 400 }
      );
    }

    // 5. Check usage limits (skip for bots to avoid inflating usage)
    const subscription = project.organization.subscription;
    const wordsLimit = subscription?.wordsLimit ?? 10_000;
    const currentMonth = parseInt(new Date().toISOString().slice(0, 7).replace("-", ""));

    if (!isBot) {
      const usageAggregate = await db.usageRecord.aggregate({
        where: { organizationId: project.organizationId, month: currentMonth },
        _sum: { words: true },
      });

      const wordsUsed = usageAggregate._sum.words ?? 0;
      const totalWords = words.reduce((sum, w) => sum + countWords(w.w), 0);

      if (wordsUsed + totalWords > wordsLimit) {
        return NextResponse.json(
          { error: "Monatliches Wortlimit erreicht", used: wordsUsed, limit: wordsLimit },
          { status: 402 }
        );
      }
    }

    // 6. Cache lookup
    const texts = words.map((w) => w.w);
    const translatedTexts: string[] = new Array(texts.length);
    const uncachedIndices: number[] = [];

    await Promise.all(
      texts.map(async (text, i) => {
        // Don't translate empty strings
        if (!text?.trim()) {
          translatedTexts[i] = text;
          return;
        }
        const hash = computeHash(text, l_from, l_to);
        const cached = await db.translation.findUnique({
          where: { projectId_originalHash: { projectId: project.id, originalHash: hash } },
        });
        if (cached) {
          translatedTexts[i] = cached.translatedText;
        } else {
          uncachedIndices.push(i);
        }
      })
    );

    // 7. Translate uncached via DeepL
    if (uncachedIndices.length > 0 && !isBot) {
      const uncachedTexts = uncachedIndices.map((i) => texts[i]);
      const results = await translateTexts({ texts: uncachedTexts, sourceLang: l_from, targetLang: l_to });

      await Promise.all(
        uncachedIndices.map(async (originalIndex, resultIndex) => {
          const translated = results[resultIndex].text;
          translatedTexts[originalIndex] = translated;

          const hash = computeHash(texts[originalIndex], l_from, l_to);
          const wordCount = countWords(texts[originalIndex]);

          await db.translation.upsert({
            where: { projectId_originalHash: { projectId: project.id, originalHash: hash } },
            create: {
              projectId: project.id,
              originalHash: hash,
              originalText: texts[originalIndex],
              translatedText: translated,
              langFrom: l_from,
              langTo: l_to,
              wordCount,
            },
            update: { translatedText: translated, updatedAt: new Date() },
          });
        })
      );

      // 8. Record usage
      const newWords = uncachedIndices.reduce((sum, i) => sum + countWords(texts[i]), 0);
      if (newWords > 0) {
        await db.usageRecord.create({
          data: {
            organizationId: project.organizationId,
            projectId: project.id,
            words: newWords,
            month: currentMonth,
          },
        });
      }
    }

    // 9. Fallback for bots or empty untranslated strings
    uncachedIndices.forEach((i) => {
      if (!translatedTexts[i]) translatedTexts[i] = texts[i];
    });

    // 10. Return Weglot-compatible response format
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
    return NextResponse.json({ error: "Interner Server-Fehler" }, { status: 500 });
  }
}

function computeHash(text: string, langFrom: string, langTo: string): string {
  return crypto.createHash("md5").update(`${text}|${langFrom}|${langTo}`).digest("hex");
}
