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

const exclusionSchema = z.object({
  type: z.string().trim().min(1),
  value: z.string().trim().min(1).max(2000),
});

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

  if (!(await userHasProjectAccess(userId, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const exclusions = await db.translationExclusion.findMany({
    where: { projectId: projektId },
    orderBy: [{ createdAt: "desc" }, { value: "asc" }],
    select: {
      id: true,
      type: true,
      value: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ exclusions });
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

  if (!(await userHasProjectAccess(userId, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const parsed = exclusionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: t(locale, "Ungültige Eingabe", "Invalid input") },
      { status: 400 }
    );
  }

  let normalized;
  try {
    normalized = normalizeExclusionInput(parsed.data);
  } catch {
    return NextResponse.json(
      { error: t(locale, "Ungültige Ausnahmeregel", "Invalid exclusion rule") },
      { status: 400 }
    );
  }

  try {
    const exclusion = await db.translationExclusion.create({
      data: {
        projectId: projektId,
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

    return NextResponse.json({ exclusion }, { status: 201 });
  } catch (error) {
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

    console.error("[POST /api/projects/:projektId/exclusions] Failed:", error);
    return NextResponse.json(
      {
        error: t(
          locale,
          "Ausnahmeregel konnte nicht erstellt werden",
          "Could not create exclusion rule"
        ),
      },
      { status: 500 }
    );
  }
}
