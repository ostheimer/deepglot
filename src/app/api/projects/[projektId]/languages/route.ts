import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
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
  { params }: { params: Promise<{ projektId: string }> }
) {
  const { projektId } = await params;
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  // Adding/activating a target language changes what gets translated (and thus
  // word usage / billing), so it is a management action.
  if (!(await userCanManageProject(userId, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: t(locale, "Ungültige Sprachen", "Invalid languages") },
      { status: 400 }
    );
  }

  try {
    await db.projectLanguage.createMany({
      data: parsed.data.languages.map((langCode) => ({
        projectId: projektId,
        langCode,
        isActive: true,
      })),
      skipDuplicates: true,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[POST /api/projects/[id]/languages] Fehler:", error);
    return NextResponse.json(
      { error: t(locale, "Fehler beim Hinzufügen", "Could not add languages") },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const { projektId } = await params;
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
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

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: t(locale, "Ungültige Sprache", "Invalid language") },
      { status: 400 }
    );
  }

  await db.projectLanguage.deleteMany({
    where: { projectId: projektId, langCode: parsed.data.langCode },
  });

  return NextResponse.json({ success: true });
}
