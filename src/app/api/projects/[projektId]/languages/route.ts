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
  updateProjectTargetLanguage,
} from "@/lib/project-language-mutations";
import { normalizeTargetLocale } from "@/lib/project-language-lifecycle";
import { previewTargetLanguageRemoval, removeTargetLanguage, removeTargetLanguages } from "@/lib/project-language-removal";
import { getCookieLocale } from "@/lib/request-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

const langCodeSchema = z
  .string()
  .max(35)
  .transform(normalizeTargetLocale)
  .refine((code): code is string => code !== null)
  .transform((code) => code as string);

const addSchema = z.object({
  languages: z.array(langCodeSchema).min(1).max(200),
});

const deleteSchema = z.object({
  langCode: langCodeSchema,
  confirmationToken: z.string().regex(/^[a-f0-9]{64}$/),
});

const patchSchema = z.object({
  langCode: langCodeSchema,
  isActive: z.boolean().optional(),
  isVisible: z.boolean().optional(),
  automaticTranslation: z.boolean().optional(),
}).refine((value) => value.isActive !== undefined || value.isVisible !== undefined || value.automaticTranslation !== undefined);

const bulkSchema = z.object({
  action: z.enum(["enable", "disable", "remove"]),
  languages: z.array(z.object({ langCode: langCodeSchema, confirmationToken: z.string().regex(/^[a-f0-9]{64}$/).optional() })).min(1).max(200),
});

async function managerProjectId(params: Promise<{ projektId: string }>) {
  const { projektId } = await params;
  const userId = await getAuthenticatedUserId();
  if (!userId) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await userCanManageProject(userId, projektId))) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) };
  return { projektId, userId };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ projektId: string }> }) {
  const access = await managerProjectId(params);
  if (access.error) return access.error;
  const langCode = normalizeTargetLocale(new URL(req.url).searchParams.get("langCode") ?? "");
  if (!langCode) return NextResponse.json({ error: "Invalid language" }, { status: 400 });
  const preview = await previewTargetLanguageRemoval(db, access.projektId!, langCode);
  return preview
    ? NextResponse.json({ preview })
    : NextResponse.json({ error: "Target language not found" }, { status: 404 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projektId: string }> }) {
  const access = await managerProjectId(params);
  if (access.error) return access.error;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid language settings" }, { status: 400 });
  const updated = await updateProjectTargetLanguage(db, { projectId: access.projektId!, actorUserId: access.userId!, ...parsed.data });
  return updated
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: "Target language not found" }, { status: 404 });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projektId: string }> }) {
  const access = await managerProjectId(params);
  if (access.error) return access.error;
  const parsed = bulkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid bulk action" }, { status: 400 });
  if (parsed.data.action === "remove") {
    try {
      const results = await removeTargetLanguages(db, access.projektId!, parsed.data.languages, access.userId!);
      return NextResponse.json({ results });
    } catch {
      return NextResponse.json({ error: "Could not remove selected languages" }, { status: 500 });
    }
  }
  const seen = new Set<string>();
  const results = [];
  for (const item of parsed.data.languages) {
    if (seen.has(item.langCode)) {
      results.push({ langCode: item.langCode, status: "duplicate" });
      continue;
    }
    seen.add(item.langCode);
    try {
      const updated = await updateProjectTargetLanguage(db, {
        projectId: access.projektId!, langCode: item.langCode, isActive: parsed.data.action === "enable", actorUserId: access.userId!,
      });
      results.push({ langCode: item.langCode, status: updated ? "updated" : "not_found" });
    } catch {
      results.push({ langCode: item.langCode, status: "failed" });
    }
  }
  return NextResponse.json({ results });
}

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
      actorUserId: userId,
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

  const result = await removeTargetLanguage(db, projektId, parsed.data.langCode, parsed.data.confirmationToken, userId);
  if (result.kind === "not_found") return NextResponse.json({ error: locale === "de" ? "Zielsprache nicht gefunden" : "Target language not found" }, { status: 404 });
  if (result.kind === "stale_preview") return NextResponse.json({ error: locale === "de" ? "Die Vorschau ist nicht mehr aktuell. Bitte erneut prüfen." : "The preview is out of date. Please review it again.", preview: result.preview }, { status: 409 });
  return NextResponse.json({ success: true, removed: result.preview });
}
