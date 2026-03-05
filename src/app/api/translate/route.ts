import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api-keys";
import { translateTexts, countWords } from "@/lib/deepl";
import { db } from "@/lib/db";
import crypto from "crypto";

// Rate limiting: simple in-memory map (replace with Redis in production)
const requestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60; // requests per minute
const WINDOW_MS = 60_000;

export async function POST(req: NextRequest) {
  try {
    // 1. Extract and validate API key
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "API-Key fehlt. Header: Authorization: Bearer dg_live_..." },
        { status: 401 }
      );
    }

    const rawKey = authHeader.substring(7);
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
    const body = await req.json();
    const { words, l_from, l_to } = body as {
      words: Array<{ t: number; w: string }>;
      l_from: string;
      l_to: string;
    };

    if (!words?.length || !l_from || !l_to) {
      return NextResponse.json(
        { error: "Pflichtfelder fehlen: words, l_from, l_to" },
        { status: 400 }
      );
    }

    // 4. Validate target language is enabled for this project
    const project = apiKeyRecord.project;
    const allowedLangs = project.languages.map((l) => l.langCode.toLowerCase());

    if (!allowedLangs.includes(l_to.toLowerCase())) {
      return NextResponse.json(
        { error: `Sprache '${l_to}' ist für dieses Projekt nicht aktiviert` },
        { status: 400 }
      );
    }

    // 5. Check usage limits
    const subscription = project.organization.subscription;
    const wordsLimit = subscription?.wordsLimit ?? 10_000;
    const currentMonth = parseInt(
      new Date().toISOString().slice(0, 7).replace("-", "")
    );

    const usageAggregate = await db.usageRecord.aggregate({
      where: {
        organizationId: project.organizationId,
        month: currentMonth,
      },
      _sum: { words: true },
    });

    const wordsUsed = usageAggregate._sum.words ?? 0;
    const totalWords = words.reduce((sum, w) => sum + countWords(w.w), 0);

    if (wordsUsed + totalWords > wordsLimit) {
      return NextResponse.json(
        {
          error: "Monatliches Wortlimit erreicht",
          used: wordsUsed,
          limit: wordsLimit,
        },
        { status: 402 }
      );
    }

    // 6. Check cache for each string
    const texts = words.map((w) => w.w);
    const translatedTexts: string[] = new Array(texts.length);
    const uncachedIndices: number[] = [];

    await Promise.all(
      texts.map(async (text, i) => {
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

    // 7. Translate uncached strings via DeepL
    if (uncachedIndices.length > 0) {
      const uncachedTexts = uncachedIndices.map((i) => texts[i]);
      const results = await translateTexts({
        texts: uncachedTexts,
        sourceLang: l_from,
        targetLang: l_to,
      });

      // Store results in cache and fill response array
      await Promise.all(
        uncachedIndices.map(async (originalIndex, resultIndex) => {
          const translated = results[resultIndex].text;
          translatedTexts[originalIndex] = translated;

          const hash = computeHash(texts[originalIndex], l_from, l_to);
          const wordCount = countWords(texts[originalIndex]);

          await db.translation.upsert({
            where: {
              projectId_originalHash: { projectId: project.id, originalHash: hash },
            },
            create: {
              projectId: project.id,
              originalHash: hash,
              originalText: texts[originalIndex],
              translatedText: translated,
              langFrom: l_from,
              langTo: l_to,
              wordCount,
            },
            update: {
              translatedText: translated,
              updatedAt: new Date(),
            },
          });
        })
      );

      // 8. Record usage for newly translated words
      const newWords = uncachedIndices.reduce(
        (sum, i) => sum + countWords(texts[i]),
        0
      );

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

    // 9. Return translated words in same format as request
    const responseWords = words.map((w, i) => ({
      t: w.t,
      w: translatedTexts[i] ?? w.w,
    }));

    return NextResponse.json({ words: responseWords });
  } catch (error) {
    console.error("[/api/translate] Fehler:", error);
    return NextResponse.json(
      { error: "Interner Server-Fehler" },
      { status: 500 }
    );
  }
}

function computeHash(text: string, langFrom: string, langTo: string): string {
  return crypto
    .createHash("md5")
    .update(`${text}|${langFrom}|${langTo}`)
    .digest("hex");
}
