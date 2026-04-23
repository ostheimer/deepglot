import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";
import { getAuthenticatedUserId, userHasProjectAccess } from "@/lib/project-access";
import { queueProjectWebhookEvent } from "@/lib/project-webhook-delivery";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

const glossaryRuleSchema = z.object({
  originalTerm: z.string().trim().min(1).max(255),
  translatedTerm: z.string().trim().min(1).max(255),
  langFrom: z.string().trim().min(2).max(16),
  langTo: z.string().trim().min(2).max(16),
  caseSensitive: z.boolean().default(false),
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

  const rules = await db.glossaryRule.findMany({
    where: { projectId: projektId },
    orderBy: [{ createdAt: "desc" }, { originalTerm: "asc" }],
  });

  return NextResponse.json({ rules });
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

  const parsed = glossaryRuleSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          t(locale, "Ungültige Eingabe", "Invalid input"),
      },
      { status: 400 }
    );
  }

  try {
    const rule = await db.$transaction(async (tx) => {
      const created = await tx.glossaryRule.create({
        data: {
          projectId: projektId,
          originalTerm: parsed.data.originalTerm,
          translatedTerm: parsed.data.translatedTerm,
          langFrom: parsed.data.langFrom.toLowerCase(),
          langTo: parsed.data.langTo.toLowerCase(),
          caseSensitive: parsed.data.caseSensitive,
        },
      });

      await queueProjectWebhookEvent(
        {
          projectId: projektId,
          eventType: "glossary.upserted",
          payload: {
            type: "glossary.upserted",
            ruleId: created.id,
            originalTerm: created.originalTerm,
            translatedTerm: created.translatedTerm,
            langFrom: created.langFrom,
            langTo: created.langTo,
          },
        },
        tx
      );

      return created;
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        {
          error: t(
            locale,
            "Diese Glossarregel existiert bereits",
            "This glossary rule already exists"
          ),
        },
        { status: 409 }
      );
    }

    console.error("[POST /api/projects/:projektId/glossary] Failed:", error);

    return NextResponse.json(
      {
        error: t(
          locale,
          "Glossarregel konnte nicht erstellt werden",
          "Could not create glossary rule"
        ),
      },
      { status: 500 }
    );
  }
}
