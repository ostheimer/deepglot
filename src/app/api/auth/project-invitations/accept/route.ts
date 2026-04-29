import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashProjectInvitationToken } from "@/lib/project-invitations";
import { getCookieLocale } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

function sanitizeInvitation(invitation: NonNullable<Awaited<ReturnType<typeof loadInvitation>>>) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    langCode: invitation.langCode,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    project: {
      id: invitation.project.id,
      name: invitation.project.name,
      domain: invitation.project.domain,
    },
    inviter: {
      name: invitation.inviter.name,
      email: invitation.inviter.email,
    },
  };
}

async function loadInvitation(token: string) {
  if (!token) return null;

  return db.projectInvitation.findUnique({
    where: { tokenHash: hashProjectInvitationToken(token) },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          domain: true,
          organizationId: true,
        },
      },
      inviter: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });
}

export async function GET(request: NextRequest) {
  const locale = await getCookieLocale();
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const session = await auth();
  const invitation = await loadInvitation(token);

  if (!invitation) {
    return NextResponse.json(
      { status: "not_found", error: t(locale, "Einladung nicht gefunden", "Invitation not found") },
      { status: 404 }
    );
  }

  const existingUser = await db.user.findFirst({
    where: { email: { equals: invitation.email, mode: "insensitive" } },
    select: { id: true, email: true },
  });

  const now = new Date();
  const status = invitation.acceptedAt
    ? "accepted"
    : invitation.expiresAt <= now
      ? "expired"
      : "valid";

  return NextResponse.json({
    status,
    invitation: sanitizeInvitation(invitation),
    existingUser: Boolean(existingUser),
    authenticatedEmail: session?.user?.email ?? null,
  });
}

const acceptSchema = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(8).max(200).optional(),
});

export async function POST(request: NextRequest) {
  const locale = await getCookieLocale();
  const session = await auth();
  const parsed = acceptSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: t(locale, "Ungültige Einladung", "Invalid invitation") },
      { status: 400 }
    );
  }

  const invitation = await loadInvitation(parsed.data.token);

  if (!invitation) {
    return NextResponse.json(
      { error: t(locale, "Einladung nicht gefunden", "Invitation not found") },
      { status: 404 }
    );
  }

  if (invitation.acceptedAt) {
    return NextResponse.json(
      { error: t(locale, "Diese Einladung wurde bereits angenommen", "This invitation was already accepted") },
      { status: 409 }
    );
  }

  if (invitation.expiresAt <= new Date()) {
    return NextResponse.json(
      { error: t(locale, "Diese Einladung ist abgelaufen", "This invitation has expired") },
      { status: 410 }
    );
  }

  const existingUser = await db.user.findFirst({
    where: { email: { equals: invitation.email, mode: "insensitive" } },
  });

  if (existingUser && !session?.user?.id) {
    return NextResponse.json(
      {
        error: t(
          locale,
          "Bitte melde dich an, um diese Einladung anzunehmen",
          "Please sign in to accept this invitation"
        ),
        signInRequired: true,
        email: invitation.email,
      },
      { status: 401 }
    );
  }

  if (
    session?.user?.email &&
    session.user.email.toLowerCase() !== invitation.email.toLowerCase()
  ) {
    return NextResponse.json(
      {
        error: t(
          locale,
          "Diese Einladung gehört zu einer anderen E-Mail-Adresse",
          "This invitation belongs to a different email address"
        ),
      },
      { status: 403 }
    );
  }

  if (!existingUser && (!parsed.data.name || !parsed.data.password)) {
    return NextResponse.json(
      {
        error: t(
          locale,
          "Name und Passwort sind erforderlich",
          "Name and password are required"
        ),
      },
      { status: 400 }
    );
  }

  const result = await db.$transaction(async (tx) => {
    const user =
      existingUser ??
      (await tx.user.create({
        data: {
          email: invitation.email,
          name: parsed.data.name,
          password: await bcrypt.hash(parsed.data.password!, 12),
        },
      }));

    await tx.organizationMember.upsert({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: invitation.project.organizationId,
        },
      },
      create: {
        userId: user.id,
        organizationId: invitation.project.organizationId,
        role: "MEMBER",
      },
      update: {},
    });

    const existingProjectMember = await tx.projectMember.findFirst({
      where: {
        projectId: invitation.project.id,
        email: { equals: invitation.email, mode: "insensitive" },
      },
    });
    const member = existingProjectMember
      ? await tx.projectMember.update({
          where: { id: existingProjectMember.id },
          data: {
            userId: user.id,
            email: invitation.email,
            role: invitation.role,
            langCode: invitation.langCode,
          },
        })
      : await tx.projectMember.create({
          data: {
            projectId: invitation.project.id,
            userId: user.id,
            email: invitation.email,
            role: invitation.role,
            langCode: invitation.langCode,
          },
        });

    await tx.projectInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });

    return { user, member };
  });

  return NextResponse.json({
    ok: true,
    userId: result.user.id,
    memberId: result.member.id,
    redirectTo: withLocalePrefix(`/projects/${invitation.project.id}`, locale),
  });
}
