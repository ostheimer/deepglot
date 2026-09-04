import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES,
  MediaRuntimePayloadLimitError,
  withBoundedMediaRuntimeMutation,
} from "@/lib/media-runtime-limits";
import {
  MAX_MEDIA_IMAGE_URL_LENGTH,
  MediaReplacementError,
  assertMediaTargetLanguage,
  normalizeMediaImageUrl,
} from "@/lib/media-replacements";
import {
  getAuthenticatedUserId,
  userCanManageProject,
} from "@/lib/project-access";
import {
  isProjectRuntimeSerializationConflict,
  lockProjectRuntimeConfiguration,
} from "@/lib/project-runtime-configuration-lock";
import { getCookieLocale } from "@/lib/request-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

const NOT_FOUND_ERROR = "DEEPGLOT_MEDIA_REPLACEMENT_NOT_FOUND";
const INACTIVE_LANGUAGE_ERROR = "DEEPGLOT_MEDIA_REPLACEMENT_INACTIVE_LANGUAGE";
const MAX_SERIALIZATION_RETRIES = 3;

const mediaReplacementSelect = {
  id: true,
  langTo: true,
  originalUrl: true,
  localizedUrl: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectMediaReplacementSelect;

const mediaReplacementPatchSchema = z
  .object({
    originalUrl: z
      .string()
      .trim()
      .min(1)
      .max(MAX_MEDIA_IMAGE_URL_LENGTH)
      .optional(),
    localizedUrl: z
      .string()
      .trim()
      .min(1)
      .max(MAX_MEDIA_IMAGE_URL_LENGTH)
      .optional(),
    langTo: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/)
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.originalUrl !== undefined ||
      value.localizedUrl !== undefined ||
      value.langTo !== undefined
  );

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string; mediaId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId, mediaId } = await params;

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

  const parsed = mediaReplacementPatchSchema.safeParse(
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
          if (!(await lockProjectRuntimeConfiguration(tx, projektId))) {
            throw new Error(NOT_FOUND_ERROR);
          }

          const existing = await tx.projectMediaReplacement.findFirst({
            where: { id: mediaId, projectId: projektId },
            select: {
              originalUrl: true,
              localizedUrl: true,
              langTo: true,
              project: { select: { domain: true, originalLang: true } },
            },
          });

          if (!existing) {
            throw new Error(NOT_FOUND_ERROR);
          }

          const langTo = parsed.data.langTo ?? existing.langTo;
          const activeLanguage = await tx.projectLanguage.findFirst({
            where: {
              projectId: projektId,
              langCode: { equals: langTo, mode: "insensitive" },
              isActive: true,
            },
            select: { id: true },
          });

          if (!activeLanguage) {
            throw new Error(INACTIVE_LANGUAGE_ERROR);
          }

          assertMediaTargetLanguage(langTo, existing.project.originalLang);

          const originalUrl = normalizeMediaImageUrl(
            parsed.data.originalUrl ?? existing.originalUrl,
            existing.project.domain
          );
          const localizedUrl = normalizeMediaImageUrl(
            parsed.data.localizedUrl ?? existing.localizedUrl,
            existing.project.domain
          );
          const changes: Prisma.ProjectMediaReplacementUpdateInput = {};

          if (parsed.data.originalUrl !== undefined) {
            changes.originalUrl = originalUrl;
          }
          if (parsed.data.localizedUrl !== undefined) {
            changes.localizedUrl = localizedUrl;
          }
          if (parsed.data.langTo !== undefined) {
            changes.langTo = langTo;
          }

          return withBoundedMediaRuntimeMutation(tx, projektId, () =>
            tx.projectMediaReplacement.update({
              where: { id: mediaId, projectId: projektId },
              data: changes,
              select: mediaReplacementSelect,
            })
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      return NextResponse.json({ mediaReplacement });
    } catch (error) {
      if (
        attempt < MAX_SERIALIZATION_RETRIES - 1 &&
        ((error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034") ||
          isProjectRuntimeSerializationConflict(error))
      ) {
        continue;
      }

      if (error instanceof Error && error.message === NOT_FOUND_ERROR) {
        return NextResponse.json(
          {
            error: t(locale, "Bildersetzung nicht gefunden", "Invalid input"),
            code: "media_replacement_not_found",
          },
          { status: 404 }
        );
      }

      if (error instanceof Error && error.message === INACTIVE_LANGUAGE_ERROR) {
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

      if (error instanceof MediaRuntimePayloadLimitError) {
        return NextResponse.json(
          {
            error: t(
              locale,
              "Die Bildersetzungen überschreiten die zulässige Laufzeitgröße",
              "Invalid input"
            ),
            code: "media_replacements_payload_too_large",
            limit: MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES,
          },
          { status: 409 }
        );
      }

      if (error instanceof MediaReplacementError) {
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

      console.error(
        "[PATCH /api/projects/:projektId/media/:mediaId] Failed:",
        error
      );
      return NextResponse.json(
        {
          error: t(
            locale,
            "Bildersetzung konnte nicht aktualisiert werden",
            "Something went wrong."
          ),
          code: "media_replacement_update_failed",
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    {
      error: t(
        locale,
        "Bildersetzung konnte nicht aktualisiert werden",
        "Something went wrong."
      ),
      code: "media_replacement_update_failed",
    },
    { status: 500 }
  );
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projektId: string; mediaId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId, mediaId } = await params;

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

  const deleted = await db.projectMediaReplacement.deleteMany({
    where: { id: mediaId, projectId: projektId },
  });

  if (deleted.count === 0) {
    return NextResponse.json(
      {
        error: t(locale, "Bildersetzung nicht gefunden", "Invalid input"),
        code: "media_replacement_not_found",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
