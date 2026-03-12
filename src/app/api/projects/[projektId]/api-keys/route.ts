import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { generateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

async function verifyAccess(userId: string, projektId: string) {
  return db.project.findFirst({
    where: {
      id: projektId,
      organization: {
        members: {
          some: {
            userId,
          },
        },
      },
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const locale = await getCookieLocale();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  const { projektId } = await params;
  const project = await verifyAccess(session.user.id, projektId);
  if (!project) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const schema = z.object({
    name: z
      .string()
      .trim()
      .min(
        2,
        t(
          locale,
          "Der API-Key-Name muss mindestens 2 Zeichen lang sein",
          "The API key name must be at least 2 characters long"
        )
      )
      .max(
        80,
        t(
          locale,
          "Der API-Key-Name darf maximal 80 Zeichen lang sein",
          "The API key name must be at most 80 characters long"
        )
      ),
  });

  try {
    const parsed = schema.safeParse(await request.json());
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

    const { rawKey, apiKey } = await generateApiKey({
      projectId: projektId,
      name: parsed.data.name,
    });

    return NextResponse.json({
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
      },
      rawKey,
    });
  } catch (error) {
    console.error("[POST /api/projects/[projektId]/api-keys] Fehler:", error);
    return NextResponse.json(
      { error: t(locale, "API-Key konnte nicht erstellt werden", "Could not create API key") },
      { status: 500 }
    );
  }
}
