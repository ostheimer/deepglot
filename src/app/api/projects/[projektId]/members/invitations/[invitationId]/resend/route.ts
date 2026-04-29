import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { sendProjectInvitationEmail } from "@/lib/email";
import {
  buildProjectInvitationUrl,
  canSendProjectInvitationEmail,
  createProjectInvitationToken,
  getProjectInvitationExpiresAt,
  hashProjectInvitationToken,
} from "@/lib/project-invitations";
import { getAuthenticatedUserId, userCanManageProject } from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

export async function POST(
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
    include: {
      project: true,
      inviter: { select: { name: true, email: true } },
    },
  });

  if (!invitation) {
    return NextResponse.json(
      { error: t(locale, "Einladung nicht gefunden", "Invitation not found") },
      { status: 404 }
    );
  }

  const rawToken = createProjectInvitationToken();
  const updated = await db.projectInvitation.update({
    where: { id: invitation.id },
    data: {
      tokenHash: hashProjectInvitationToken(rawToken),
      expiresAt: getProjectInvitationExpiresAt(),
    },
    select: {
      id: true,
      email: true,
      role: true,
      langCode: true,
      expiresAt: true,
      createdAt: true,
      inviter: { select: { id: true, name: true, email: true } },
    },
  });

  let emailDelivery:
    | Awaited<ReturnType<typeof sendProjectInvitationEmail>>
    | { sent: false; reason: "email_not_configured" | "email_send_failed" };

  if (canSendProjectInvitationEmail()) {
    try {
      emailDelivery = await sendProjectInvitationEmail({
        to: invitation.email,
        inviteUrl: buildProjectInvitationUrl({ token: rawToken, locale }),
        locale,
        projectName: invitation.project.name,
        inviterName: invitation.inviter.name ?? invitation.inviter.email,
      });
    } catch (error) {
      console.error("[POST /api/projects/:projektId/members/invitations/:id/resend] Email failed:", error);
      emailDelivery = { sent: false, reason: "email_send_failed" };
    }
  } else {
    emailDelivery = { sent: false, reason: "email_not_configured" };
  }

  return NextResponse.json({ invitation: updated, emailDelivery });
}
