import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
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
