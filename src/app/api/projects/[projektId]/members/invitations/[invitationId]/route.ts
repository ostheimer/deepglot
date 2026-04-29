import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getAuthenticatedUserId, userCanManageProject } from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
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

  await db.projectInvitation.delete({ where: { id: invitation.id } });

  return NextResponse.json({ ok: true });
}
