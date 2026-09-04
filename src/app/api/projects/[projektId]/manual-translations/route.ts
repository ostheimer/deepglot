import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { verifyEditorSessionToken } from "@/lib/editor-session";
import { lockAndValidateProjectLanguageWrite } from "@/lib/project-runtime-configuration-lock";
import { queueProjectWebhookEvent } from "@/lib/project-webhook-delivery";
import { recordTranslationBatch, upsertTranslatedUrlHit } from "@/lib/translation-batches";
import { computeTranslationHash } from "@/lib/translation-hash";
import { workflowResetFieldsIfTranslatedTextChanged } from "@/lib/translation-workflow";
import {
  assertPostgresTextFields,
  inspectPostgresText,
  reportPostgresTextRejection,
} from "@/lib/postgres-text";
import {
  PLUGIN_RATE_LIMIT_SCOPE,
  buildRateLimitHeaders,
  consumeRateLimit,
  getRateLimitConfig,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

const manualTranslationSchema = z.object({
  token: z.string().min(1),
  originalText: z.string().trim().min(1),
  translatedText: z.string().trim().min(1),
  langFrom: z.string().trim().min(2).max(16).transform((value) => value.toLowerCase()),
  langTo: z.string().trim().min(2).max(16).transform((value) => value.toLowerCase()),
  requestUrl: z.string().url().optional(),
});

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const { projektId } = await params;
  const rawBody = (await request.json()) as unknown;
  const parsed = manualTranslationSchema.safeParse(rawBody);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? "Invalid manual translation payload.",
      },
      {
        status: 400,
        headers: corsHeaders(request),
      }
    );
  }

  const claims = verifyEditorSessionToken(parsed.data.token);

  if (!claims || claims.projectId !== projektId) {
    return NextResponse.json(
      { error: "Invalid or expired editor token." },
      {
        status: 401,
        headers: corsHeaders(request),
      }
    );
  }

  const nulErrors: Record<string, string[]> = {};
  for (const field of [
    "originalText",
    "translatedText",
    "langFrom",
    "langTo",
    "requestUrl",
  ] as const) {
    const value = parsed.data[field];
    if (typeof value !== "string") continue;
    const error = inspectPostgresText(value, {
      boundary: "manual_translation_input",
      field,
    });
    if (!error) continue;

    reportPostgresTextRejection(error);
    nulErrors[field] = [
      "NUL-Zeichen (U+0000) sind in Übersetzungstexten nicht erlaubt.",
    ];
  }

  if (Object.keys(nulErrors).length > 0) {
    return NextResponse.json(
      {
        error: "Die Übersetzung enthält ein nicht unterstütztes NUL-Zeichen.",
        code: "validation_failed",
        errors: nulErrors,
      },
      { status: 400, headers: corsHeaders(request) },
    );
  }

  // The editor token is bound to a single target language (see
  // createEditorSessionToken), so it can only write that language. This stops a
  // language-scoped translator's token from editing other languages.
  if (parsed.data.langTo !== claims.langTo) {
    return NextResponse.json(
      { error: "Editor token is not valid for this language." },
      { status: 403, headers: corsHeaders(request) }
    );
  }

  // Rate-limit editor writes per project. The token rides in the launch URL, so
  // this bounds the damage if one leaks within its 15-minute lifetime.
  const rateLimit = await consumeRateLimit({
    scope: PLUGIN_RATE_LIMIT_SCOPE,
    subject: `manual-translations:${projektId}`,
    limit: getRateLimitConfig().pluginPerMinute,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many edits. Please slow down and retry shortly." },
      {
        status: 429,
        headers: { ...corsHeaders(request), ...buildRateLimitHeaders(rateLimit) },
      }
    );
  }

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: {
      organization: true,
    },
  });

  if (!project) {
    return NextResponse.json(
      { error: "Project not found." },
      {
        status: 404,
        headers: corsHeaders(request),
      }
    );
  }

  // The editor always translates from the project's original language; reject
  // anything else so a token can't write arbitrary language pairs.
  if (parsed.data.langFrom !== project.originalLang.toLowerCase()) {
    return NextResponse.json(
      { error: "langFrom must match the project's original language." },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  const wordCount = countWords(parsed.data.originalText);
  const originalHash = computeTranslationHash(
    parsed.data.originalText,
    parsed.data.langFrom,
    parsed.data.langTo
  );

  const persistenceResult = await db.$transaction(async (tx) => {
    const languageConfigurationIsCurrent =
      await lockAndValidateProjectLanguageWrite(tx, {
        projectId: projektId,
        sourceLanguages: [parsed.data.langFrom],
        targetLanguages: [parsed.data.langTo],
      });
    if (!languageConfigurationIsCurrent) {
      return { kind: "language_configuration_changed" } as const;
    }

    const existing = await tx.translation.findUnique({
      where: {
        projectId_originalHash: {
          projectId: projektId,
          originalHash,
        },
      },
      select: {
        id: true,
        workflowStatus: true,
        assignedToId: true,
        translatedText: true,
      },
    });

    assertPostgresTextFields(
      {
        originalText: parsed.data.originalText,
        translatedText: parsed.data.translatedText,
        langFrom: parsed.data.langFrom,
        langTo: parsed.data.langTo,
      },
      { boundary: "manual_translation_persistence" },
    );

    const saved = await tx.translation.upsert({
      where: {
        projectId_originalHash: {
          projectId: projektId,
          originalHash,
        },
      },
      create: {
        projectId: projektId,
        originalHash,
        originalText: parsed.data.originalText,
        translatedText: parsed.data.translatedText,
        langFrom: parsed.data.langFrom,
        langTo: parsed.data.langTo,
        isManual: true,
        source: "MANUAL",
        wordCount,
      },
      update: {
        translatedText: parsed.data.translatedText,
        langFrom: parsed.data.langFrom,
        langTo: parsed.data.langTo,
        isManual: true,
        source: "MANUAL",
        wordCount,
        ...(existing
          ? workflowResetFieldsIfTranslatedTextChanged(
              existing,
              parsed.data.translatedText,
            )
          : {}),
      },
    });

    await recordTranslationBatch(
      {
        organizationId: project.organizationId,
        projectId: projektId,
        langFrom: parsed.data.langFrom,
        langTo: parsed.data.langTo,
        requestUrl: parsed.data.requestUrl ?? null,
        provider: "manual",
        totalWords: wordCount,
        cachedWords: 0,
        manualWords: wordCount,
        glossaryWords: 0,
        translatedWords: 0,
      },
      tx
    );

    await upsertTranslatedUrlHit(
      {
        projectId: projektId,
        langTo: parsed.data.langTo,
        requestUrl: parsed.data.requestUrl ?? null,
        wordCount,
        tx,
      },
    );

    await queueProjectWebhookEvent(
      {
        projectId: projektId,
        eventType: "translation.manual_updated",
        payload: {
          type: "translation.manual_updated",
          translationId: saved.id,
          originalText: saved.originalText,
          translatedText: saved.translatedText,
          langFrom: saved.langFrom,
          langTo: saved.langTo,
          created: !existing,
        },
      },
      tx
    );

    return { kind: "saved", translation: saved } as const;
  });

  if (persistenceResult.kind === "language_configuration_changed") {
    return NextResponse.json(
      {
        error:
          "The project's source or target language changed. Reload the editor and retry.",
        code: "project_language_configuration_changed",
      },
      { status: 409, headers: corsHeaders(request) },
    );
  }

  return NextResponse.json(
    { ok: true, translation: persistenceResult.translation },
    {
      headers: corsHeaders(request),
    }
  );
}
