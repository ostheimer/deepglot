import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { verifyEditorSessionToken } from "@/lib/editor-session";
import { queueProjectWebhookEvent } from "@/lib/project-webhook-delivery";
import { recordTranslationBatch, upsertTranslatedUrlHit } from "@/lib/translation-batches";
import { computeTranslationHash } from "@/lib/translation-hash";

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
  const parsed = manualTranslationSchema.safeParse(await request.json());

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

  const wordCount = countWords(parsed.data.originalText);
  const originalHash = computeTranslationHash(
    parsed.data.originalText,
    parsed.data.langFrom,
    parsed.data.langTo
  );

  const translation = await db.$transaction(async (tx) => {
    const existing = await tx.translation.findUnique({
      where: {
        projectId_originalHash: {
          projectId: projektId,
          originalHash,
        },
      },
    });

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

    return saved;
  });

  return NextResponse.json(
    { ok: true, translation },
    {
      headers: corsHeaders(request),
    }
  );
}
