import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CLEARED_RUNTIME_SYNC_ORIGIN } from "@/lib/plugin-settings-sync";
import { userCanManageProject } from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

/**
 * Forget the host recorded by the last plugin sync. Managers use this after
 * moving a foreign installation to its own project; the next sync from any
 * installation records a fresh origin.
 */
export async function DELETE(
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
  if (!(await userCanManageProject(session.user.id, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  await db.projectSettings.updateMany({
    where: { projectId: projektId },
    data: CLEARED_RUNTIME_SYNC_ORIGIN,
  });

  return NextResponse.json({ success: true });
}
