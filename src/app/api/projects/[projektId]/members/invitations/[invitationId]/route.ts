import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { canManageProjectForWrite, getAuthenticatedUserId, userCanManageProject } from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projektId: string; invitationId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId, invitationId } = await params;

  if (!userId) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  if (!(await userCanManageProject(userId, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const invitation = await db.projectInvitation.findFirst({
    where: { id: invitationId, projectId: projektId, acceptedAt: null },
  });

  if (!invitation) {
    return NextResponse.json(
      { error: t(locale, "Einladung nicht gefunden", "Invitation not found") },
      { status: 404 }
    );
  }

  const deleted = await db.$transaction(async (tx) => {
    if (!(await canManageProjectForWrite(tx, userId, projektId))) return false;
    await tx.projectInvitation.deleteMany({ where: { id: invitation.id, projectId: projektId, acceptedAt: null } });
    return true;
  });
  if (!deleted) return NextResponse.json({ error: t(locale, "Projekt nicht gefunden", "Project not found") }, { status: 404 });

  return NextResponse.json({ ok: true });
}
