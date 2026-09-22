import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES,
  MediaRuntimePayloadLimitError,
} from "@/lib/media-runtime-limits";
import {
  MAX_RUNTIME_MEDIA_REPLACEMENTS,
  MediaReplacementError,
} from "@/lib/media-replacements";
import {
  getAuthenticatedUserId,
  userCanManageProject,
} from "@/lib/project-access";
import {
  addProjectTargetLanguages,
  deleteProjectTargetLanguage,
} from "@/lib/project-language-mutations";
import { getCookieLocale } from "@/lib/request-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

// ISO 639-1/3 with an optional region/script subtag, e.g. "en", "pt-br".
const langCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/);

const addSchema = z.object({
  languages: z.array(langCodeSchema).min(1).max(200),
});

const deleteSchema = z.object({
  langCode: langCodeSchema,
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projektId: string }> },
) {
  const { projektId } = await params;
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 },
    );
  }

  // Adding/activating a target language changes what gets translated (and thus
  // word usage / billing), so it is a management action.
  if (!(await userCanManageProject(userId, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 },
    );
  }

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: t(locale, "Ungültige Sprachen", "Invalid languages") },
      { status: 400 },
    );
  }

  try {
    const result = await addProjectTargetLanguages(db, {
      projectId: projektId,
      languages: parsed.data.languages,
    });

    if (result.kind === "not_found") {
      return NextResponse.json(
        { error: t(locale, "Projekt nicht gefunden", "Project not found") },
        { status: 404 },
      );
    }
    if (result.kind === "source_language_cannot_be_target") {
      return NextResponse.json(
        {
          error: t(
            locale,
            "Die Originalsprache kann nicht als Zielsprache hinzugefügt werden.",
            "The original language cannot be added as a target language.",
          ),
          code: "source_language_cannot_be_target",
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof MediaRuntimePayloadLimitError) {
      return NextResponse.json(
        {
          error: t(
            locale,
            "Die Bildersetzungen überschreiten die zulässige Laufzeitgröße.",
            "Could not add languages",
          ),
          code: "media_replacements_payload_too_large",
          limit: MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES,
        },
        { status: 409 },
      );
    }

    if (
      error instanceof MediaReplacementError &&
      error.code === "MEDIA_REPLACEMENTS_LIMIT_EXCEEDED"
    ) {
      return NextResponse.json(
        {
          error: t(
            locale,
            `Pro Projekt sind höchstens ${MAX_RUNTIME_MEDIA_REPLACEMENTS} Bildersetzungen möglich.`,
            "Could not add languages",
          ),
          code: "media_replacements_limit_exceeded",
          limit: MAX_RUNTIME_MEDIA_REPLACEMENTS,
        },
        { status: 409 },
      );
    }

    console.error("[POST /api/projects/[id]/languages] Fehler:", error);
    return NextResponse.json(
      { error: t(locale, "Fehler beim Hinzufügen", "Could not add languages") },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projektId: string }> },
) {
  const { projektId } = await params;
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 },
    );
  }

  if (!(await userCanManageProject(userId, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 },
    );
  }

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: t(locale, "Ungültige Sprache", "Invalid language") },
      { status: 400 },
    );
  }

  const projectFound = await deleteProjectTargetLanguage(db, {
    projectId: projektId,
    langCode: parsed.data.langCode,
  });

  if (!projectFound) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true });
}
