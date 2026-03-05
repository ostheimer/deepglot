import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const { projektId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  try {
    const { languages } = await req.json();

    if (!Array.isArray(languages) || languages.length === 0) {
      return NextResponse.json({ error: "Keine Sprachen angegeben" }, { status: 400 });
    }

    // Verify project access
    const project = await db.project.findUnique({
      where: { id: projektId },
      include: { organization: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Projekt nicht gefunden" }, { status: 404 });
    }

    const membership = await db.organizationMember.findFirst({
      where: { userId: session.user.id, organizationId: project.organizationId },
    });

    if (!membership) {
      return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
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
    return NextResponse.json({ error: "Fehler beim Hinzufügen" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const { projektId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  const { langCode } = await req.json();

  await db.projectLanguage.deleteMany({
    where: { projectId: projektId, langCode },
  });

  return NextResponse.json({ success: true });
}
