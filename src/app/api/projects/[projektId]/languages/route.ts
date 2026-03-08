import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const { projektId } = await params;
  const locale = await getCookieLocale();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  try {
    const { languages } = await req.json();

    if (!Array.isArray(languages) || languages.length === 0) {
      return NextResponse.json(
        { error: t(locale, "Keine Sprachen angegeben", "No languages provided") },
        { status: 400 }
      );
    }

    // Verify project access
    const project = await db.project.findUnique({
      where: { id: projektId },
      include: { organization: true },
    });

    if (!project) {
      return NextResponse.json(
        { error: t(locale, "Projekt nicht gefunden", "Project not found") },
        { status: 404 }
      );
    }

    const membership = await db.organizationMember.findFirst({
      where: { userId: session.user.id, organizationId: project.organizationId },
    });

    if (!membership) {
      return NextResponse.json(
        { error: t(locale, "Keine Berechtigung", "Permission denied") },
        { status: 403 }
      );
    }

    await db.projectLanguage.createMany({
      data: languages.map((langCode: string) => ({
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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  const { langCode } = await req.json();

  await db.projectLanguage.deleteMany({
    where: { projectId: projektId, langCode },
  });

  return NextResponse.json({ success: true });
}
