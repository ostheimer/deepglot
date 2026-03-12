import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

export async function POST(
  _request: Request,
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
  const project = await db.project.findFirst({
    where: {
      id: projektId,
      organization: {
        members: {
          some: {
            userId: session.user.id,
          },
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  await db.projectSettings.upsert({
    where: { projectId: projektId },
    create: {
      projectId: projektId,
      pageViewsEnabled: true,
    },
    update: {
      pageViewsEnabled: true,
    },
  });

  return NextResponse.json({ success: true });
}
