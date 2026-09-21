import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CLEARED_RUNTIME_SYNC_ORIGIN } from "@/lib/plugin-settings-sync";
import { userCanManageProject } from "@/lib/project-access";
import { lockProjectRuntimeConfiguration } from "@/lib/project-runtime-configuration-lock";
import { getCookieLocale } from "@/lib/request-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

/**
 * Forget the site recorded by the last plugin sync. The caller names the
 * site it saw; if a newer sync recorded another site in the meantime the
 * request is refused so a fresh reuse event is never wiped by a stale click.
 * Managers use this after moving a foreign installation to its own project.
 */
export async function DELETE(
  request: Request,
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

  const body = (await request.json().catch(() => null)) as
    | { siteHost?: unknown }
    | null;
  const expectedSiteHost =
    typeof body?.siteHost === "string" && body.siteHost.trim()
      ? body.siteHost.trim()
      : null;
  if (!expectedSiteHost) {
    return NextResponse.json(
      { error: t(locale, "Ungültige Anfrage", "Invalid request") },
      { status: 400 }
    );
  }

  const cleared = await db.$transaction(async (tx) => {
    if (!(await lockProjectRuntimeConfiguration(tx, projektId))) {
      return false;
    }
    const result = await tx.projectSettings.updateMany({
      where: { projectId: projektId, runtimeSyncSiteHost: expectedSiteHost },
      data: CLEARED_RUNTIME_SYNC_ORIGIN,
    });
    return result.count === 1;
  });

  if (!cleared) {
    return NextResponse.json(
      {
        error: t(
          locale,
          "Die Warnung hat sich inzwischen geändert. Lade die Seite neu.",
          "The warning changed in the meantime. Reload the page."
        ),
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true });
}
