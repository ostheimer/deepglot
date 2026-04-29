import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";
import { sendProjectInvitationEmail } from "@/lib/email";
import {
  buildProjectInvitationUrl,
  canSendProjectInvitationEmail,
  createProjectInvitationToken,
  getProjectInvitationExpiresAt,
  hashProjectInvitationToken,
  normalizeProjectInvitationEmail,
} from "@/lib/project-invitations";
import { getAuthenticatedUserId, userCanManageProject } from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "TRANSLATOR"]),
  langCode: z.string().trim().min(2).max(16).nullable().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId } = await params;

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

  const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: t(locale, "Ungültige Einladung", "Invalid invitation") },
      { status: 400 }
    );
  }

  const email = normalizeProjectInvitationEmail(parsed.data.email);
  const langCode = parsed.data.langCode?.toLowerCase() || null;
  const rawToken = createProjectInvitationToken();
  const tokenHash = hashProjectInvitationToken(rawToken);

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: {
      languages: { where: { isActive: true } },
      organization: true,
    },
  });

  if (!project) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  if (langCode && !project.languages.some((language) => language.langCode === langCode)) {
    return NextResponse.json(
      { error: t(locale, "Diese Sprache ist nicht aktiv", "This language is not active") },
      { status: 400 }
    );
  }

  const existingMember = await db.projectMember.findFirst({
    where: {
      projectId: projektId,
      email: { equals: email, mode: "insensitive" },
    },
  });

  if (existingMember) {
    return NextResponse.json(
      {
        error: t(
          locale,
          "Diese E-Mail-Adresse ist bereits Projektmitglied",
          "This email address is already a project member"
        ),
      },
      { status: 409 }
    );
  }

  const existingPendingInvite = await db.projectInvitation.findFirst({
    where: {
      projectId: projektId,
      email,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (existingPendingInvite) {
    return NextResponse.json(
      {
        error: t(
          locale,
          "Für diese E-Mail-Adresse gibt es bereits eine offene Einladung",
          "This email address already has a pending invitation"
        ),
      },
      { status: 409 }
    );
  }

  try {
    const invitation = await db.projectInvitation.create({
      data: {
        projectId: projektId,
        inviterId: userId,
        email,
        role: parsed.data.role,
        langCode,
        tokenHash,
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
          to: email,
          inviteUrl: buildProjectInvitationUrl({ token: rawToken, locale }),
          locale,
          projectName: project.name,
          inviterName: invitation.inviter.name ?? invitation.inviter.email,
        });
      } catch (error) {
        console.error("[POST /api/projects/:projektId/members/invite] Email failed:", error);
        emailDelivery = { sent: false, reason: "email_send_failed" };
      }
    } else {
      emailDelivery = { sent: false, reason: "email_not_configured" };
    }

    return NextResponse.json({ invitation, emailDelivery }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: t(locale, "Diese Einladung existiert bereits", "This invitation already exists") },
        { status: 409 }
      );
    }

    console.error("[POST /api/projects/:projektId/members/invite] Failed:", error);
    return NextResponse.json(
      { error: t(locale, "Einladung konnte nicht erstellt werden", "Could not create invitation") },
      { status: 500 }
    );
  }
}
