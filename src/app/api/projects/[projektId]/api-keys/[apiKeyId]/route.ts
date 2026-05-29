import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userCanManageProject } from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: { params: Promise<{ projektId: string; apiKeyId: string }> }
) {
  const locale = await getCookieLocale();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  const { projektId, apiKeyId } = await params;

  // Revoking an API key is a management action; gate on management rights.
  if (!(await userCanManageProject(session.user.id, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const apiKey = await db.apiKey.findFirst({
    where: {
      id: apiKeyId,
      projectId: projektId,
    },
  });

  if (!apiKey) {
    return NextResponse.json(
      { error: t(locale, "API-Key nicht gefunden", "API key not found") },
      { status: 404 }
    );
  }

  await db.apiKey.delete({
    where: { id: apiKey.id },
  });

  return NextResponse.json({ success: true });
}
