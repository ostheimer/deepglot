import { NextResponse } from "next/server";

import { getAuthenticatedUserId, userCanManageProject } from "@/lib/project-access";
import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

export async function GET(
  _request: Request,
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

  const [members, invitations, project] = await Promise.all([
    db.projectMember.findMany({
      where: { projectId: projektId },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.projectInvitation.findMany({
      where: { projectId: projektId, acceptedAt: null },
      select: {
        id: true,
        email: true,
        role: true,
        langCode: true,
        expiresAt: true,
        createdAt: true,
        inviter: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.project.findUnique({
      where: { id: projektId },
      include: {
        languages: { where: { isActive: true }, orderBy: { langCode: "asc" } },
        organization: {
          include: {
            members: {
              where: { role: { in: ["OWNER", "ADMIN"] } },
              include: { user: { select: { id: true, name: true, email: true, image: true } } },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    }),
  ]);

  return NextResponse.json({
    members,
    invitations,
    languages: project?.languages ?? [],
    organizationAdmins: project?.organization.members ?? [],
  });
}
