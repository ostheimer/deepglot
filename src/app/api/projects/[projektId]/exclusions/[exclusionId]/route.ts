import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";
import { normalizeExclusionInput } from "@/lib/exclusions";
import { getAuthenticatedUserId, userHasProjectAccess } from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

const NOT_FOUND_ERROR = "DEEPGLOT_EXCLUSION_NOT_FOUND";

const exclusionPatchSchema = z
  .object({
    type: z.string().trim().min(1).optional(),
    value: z.string().trim().min(1).max(2000).optional(),
  })
  .refine((value) => value.type !== undefined || value.value !== undefined);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string; exclusionId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId, exclusionId } = await params;

  if (!userId) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  if (!(await userHasProjectAccess(userId, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const parsed = exclusionPatchSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: t(locale, "Ungültige Eingabe", "Invalid input") },
      { status: 400 }
    );
  }

  try {
    const exclusion = await db.$transaction(async (tx) => {
      const existing = await tx.translationExclusion.findFirst({
        where: { id: exclusionId, projectId: projektId },
      });

      if (!existing) {
        throw new Error(NOT_FOUND_ERROR);
      }

      const normalized = normalizeExclusionInput({
        type: parsed.data.type ?? existing.type,
        value: parsed.data.value ?? existing.value,
      });

      return tx.translationExclusion.update({
        where: { id: exclusionId },
        data: {
          type: normalized.type,
          value: normalized.value,
        },
        select: {
          id: true,
          type: true,
          value: true,
          createdAt: true,
        },
      });
    });

    return NextResponse.json({ exclusion });
  } catch (error) {
    if (error instanceof Error && error.message === NOT_FOUND_ERROR) {
      return NextResponse.json(
        { error: t(locale, "Ausnahmeregel nicht gefunden", "Exclusion rule not found") },
        { status: 404 }
      );
    }

    if (
      error instanceof Error &&
      (error.message === "INVALID_EXCLUSION_TYPE" ||
        error.message === "EMPTY_EXCLUSION_VALUE")
    ) {
      return NextResponse.json(
        { error: t(locale, "Ungültige Ausnahmeregel", "Invalid exclusion rule") },
        { status: 400 }
      );
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        {
          error: t(
            locale,
            "Diese Ausnahmeregel existiert bereits",
            "This exclusion rule already exists"
          ),
        },
        { status: 409 }
      );
    }

    console.error("[PATCH /api/projects/:projektId/exclusions/:exclusionId] Failed:", error);
    return NextResponse.json(
      {
        error: t(
          locale,
          "Ausnahmeregel konnte nicht aktualisiert werden",
          "Could not update exclusion rule"
        ),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projektId: string; exclusionId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId, exclusionId } = await params;

  if (!userId) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  if (!(await userHasProjectAccess(userId, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const existing = await db.translationExclusion.findFirst({
    where: { id: exclusionId, projectId: projektId },
    select: { id: true },
  });

  if (!existing) {
    return NextResponse.json(
      { error: t(locale, "Ausnahmeregel nicht gefunden", "Exclusion rule not found") },
      { status: 404 }
    );
  }

  await db.translationExclusion.delete({
    where: { id: existing.id },
  });

  return NextResponse.json({ ok: true });
}
