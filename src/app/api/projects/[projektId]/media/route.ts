import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  MAX_MEDIA_IMAGE_URL_LENGTH,
  MAX_RUNTIME_MEDIA_REPLACEMENTS,
  MediaReplacementError,
  assertMediaReplacementCapacity,
  normalizeMediaImageUrl,
} from "@/lib/media-replacements";
import {
  getAuthenticatedUserId,
  userCanManageProject,
} from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

const mediaReplacementSelect = {
  id: true,
  langTo: true,
  originalUrl: true,
  localizedUrl: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectMediaReplacementSelect;

const mediaReplacementSchema = z
  .object({
    originalUrl: z.string().trim().min(1).max(MAX_MEDIA_IMAGE_URL_LENGTH),
    localizedUrl: z.string().trim().min(1).max(MAX_MEDIA_IMAGE_URL_LENGTH),
    langTo: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/),
  })
  .strict();

const MAX_SERIALIZATION_RETRIES = 3;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId } = await params;

  if (!userId) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  if (!(await userCanManageProject(userId, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const mediaReplacements = await db.projectMediaReplacement.findMany({
    where: { projectId: projektId },
    orderBy: [{ langTo: "asc" }, { originalUrl: "asc" }],
    select: mediaReplacementSelect,
    take: MAX_RUNTIME_MEDIA_REPLACEMENTS + 1,
  });

  return NextResponse.json({
    mediaReplacements,
    limitExceeded: mediaReplacements.length > MAX_RUNTIME_MEDIA_REPLACEMENTS,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId } = await params;

  if (!userId) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  if (!(await userCanManageProject(userId, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const parsed = mediaReplacementSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: t(locale, "Ungültige Eingabe", "Invalid input") },
      { status: 400 }
    );
  }

  for (let attempt = 0; attempt < MAX_SERIALIZATION_RETRIES; attempt += 1) {
    try {
      const mediaReplacement = await db.$transaction(
        async (tx) => {
          const targetLanguage = await tx.projectLanguage.findFirst({
            where: {
              projectId: projektId,
              langCode: parsed.data.langTo,
              isActive: true,
            },
            select: { project: { select: { domain: true } } },
          });

          if (!targetLanguage) {
            throw new MediaReplacementError(
              "The target language is not active for this project.",
              "INVALID_TARGET_LANGUAGE"
            );
          }

          const currentCount = await tx.projectMediaReplacement.count({
            where: { projectId: projektId },
          });
          assertMediaReplacementCapacity(currentCount);

          const projectDomain = targetLanguage.project.domain;
          return tx.projectMediaReplacement.create({
            data: {
              projectId: projektId,
              langTo: parsed.data.langTo,
              originalUrl: normalizeMediaImageUrl(
                parsed.data.originalUrl,
                projectDomain
              ),
              localizedUrl: normalizeMediaImageUrl(
                parsed.data.localizedUrl,
                projectDomain
              ),
            },
            select: mediaReplacementSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      return NextResponse.json({ mediaReplacement }, { status: 201 });
    } catch (error) {
      if (error instanceof MediaReplacementError) {
        if (error.code === "INVALID_TARGET_LANGUAGE") {
          return NextResponse.json(
            {
              error: t(
                locale,
                "Die Zielsprache ist für dieses Projekt nicht aktiviert",
                "This language is not active"
              ),
              code: "inactive_target_language",
            },
            { status: 400 }
          );
        }

        if (error.code === "MEDIA_REPLACEMENTS_LIMIT_EXCEEDED") {
          return NextResponse.json(
            {
              error: t(
                locale,
                `Pro Projekt sind höchstens ${MAX_RUNTIME_MEDIA_REPLACEMENTS} Bildersetzungen möglich`,
                "Invalid input"
              ),
              code: "media_replacements_limit_exceeded",
              limit: MAX_RUNTIME_MEDIA_REPLACEMENTS,
            },
            { status: 409 }
          );
        }

        return NextResponse.json(
          {
            error: t(
              locale,
              "Ungültige Bild-URL: Nur sichere Bilder derselben Website sind zulässig",
              "Invalid input"
            ),
            code: "invalid_media_image_url",
          },
          { status: 400 }
        );
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2034" && attempt < MAX_SERIALIZATION_RETRIES - 1) {
          continue;
        }

        if (error.code === "P2002") {
          return NextResponse.json(
            {
              error: t(
                locale,
                "Für dieses Bild und diese Zielsprache existiert bereits eine Ersetzung",
                "Invalid input"
              ),
              code: "media_replacement_already_exists",
            },
            { status: 409 }
          );
        }
      }

      console.error("[POST /api/projects/:projektId/media] Failed:", error);
      return NextResponse.json(
        {
          error: t(
            locale,
            "Bildersetzung konnte nicht erstellt werden",
            "Something went wrong."
          ),
          code: "media_replacement_create_failed",
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    {
      error: t(
        locale,
        "Bildersetzung konnte nicht erstellt werden",
        "Something went wrong."
      ),
      code: "media_replacement_create_failed",
    },
    { status: 500 }
  );
}
