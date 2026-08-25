import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";
import { getAuthenticatedUserId, userHasProjectAccess } from "@/lib/project-access";
import { lockAndValidateProjectLanguageWrite } from "@/lib/project-runtime-configuration-lock";
import { queueProjectWebhookEvent } from "@/lib/project-webhook-delivery";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
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

      return { kind: "created", rule: created } as const;
    });

    if (persistenceResult.kind === "language_configuration_changed") {
      return NextResponse.json(
        {
          error: t(
            locale,
            "Die Sprachkonfiguration des Projekts hat sich geändert. Bitte neu laden und erneut versuchen.",
            "The project's language configuration changed. Reload and retry.",
          ),
          code: "project_language_configuration_changed",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ rule: persistenceResult.rule }, { status: 201 });
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
