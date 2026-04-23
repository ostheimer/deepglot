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

const NOT_FOUND_ERROR = "DEEPGLOT_GLOSSARY_NOT_FOUND";

const glossaryRuleSchema = z.object({
  originalTerm: z.string().trim().min(1).max(255),
  translatedTerm: z.string().trim().min(1).max(255),
  langFrom: z.string().trim().min(2).max(16),
  langTo: z.string().trim().min(2).max(16),
  caseSensitive: z.boolean().default(false),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string; ruleId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId, ruleId } = await params;

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
      const existing = await tx.glossaryRule.findFirst({
        where: { id: ruleId, projectId: projektId },
      });

      if (!existing) {
        throw new Error(NOT_FOUND_ERROR);
      }

      const updated = await tx.glossaryRule.update({
        where: { id: ruleId },
        data: {
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
            ruleId: updated.id,
            originalTerm: updated.originalTerm,
            translatedTerm: updated.translatedTerm,
            langFrom: updated.langFrom,
            langTo: updated.langTo,
          },
        },
        tx
      );

      return updated;
    });

    return NextResponse.json({ rule });
  } catch (error) {
    if (error instanceof Error && error.message === NOT_FOUND_ERROR) {
      return NextResponse.json(
        { error: t(locale, "Glossarregel nicht gefunden", "Glossary rule not found") },
        { status: 404 }
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
            "Diese Glossarregel existiert bereits",
            "This glossary rule already exists"
          ),
        },
        { status: 409 }
      );
    }

    console.error("[PATCH /api/projects/:projektId/glossary/:ruleId] Failed:", error);

    return NextResponse.json(
      {
        error: t(
          locale,
          "Glossarregel konnte nicht aktualisiert werden",
          "Could not update glossary rule"
        ),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projektId: string; ruleId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId, ruleId } = await params;

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

  try {
    await db.$transaction(async (tx) => {
      const deleted = await tx.glossaryRule.findFirst({
        where: { id: ruleId, projectId: projektId },
      });

      if (!deleted) {
        throw new Error(NOT_FOUND_ERROR);
      }

      await tx.glossaryRule.delete({
        where: { id: deleted.id },
      });

      await queueProjectWebhookEvent(
        {
          projectId: projektId,
          eventType: "glossary.deleted",
          payload: {
            type: "glossary.deleted",
            ruleId: deleted.id,
            originalTerm: deleted.originalTerm,
            translatedTerm: deleted.translatedTerm,
            langFrom: deleted.langFrom,
            langTo: deleted.langTo,
          },
        },
        tx
      );
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === NOT_FOUND_ERROR) {
      return NextResponse.json(
        { error: t(locale, "Glossarregel nicht gefunden", "Glossary rule not found") },
        { status: 404 }
      );
    }

    console.error("[DELETE /api/projects/:projektId/glossary/:ruleId] Failed:", error);

    return NextResponse.json(
      {
        error: t(
          locale,
          "Glossarregel konnte nicht gelöscht werden",
          "Could not delete glossary rule"
        ),
      },
      { status: 500 }
    );
  }
}
