import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getAuthenticatedUserId, userCanManageProject } from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";
import { resetProjectMemberWorkflowAssignments } from "@/lib/translation-workflow";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

const patchMemberSchema = z.object({
  role: z.enum(["ADMIN", "TRANSLATOR"]).optional(),
  langCode: z.string().trim().min(2).max(16).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string; memberId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId, memberId } = await params;

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

  const parsed = patchMemberSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: t(locale, "Ungültige Eingabe", "Invalid input") },
      { status: 400 }
    );
  }

  const member = await db.projectMember.findFirst({
    where: { id: memberId, projectId: projektId },
  });

  if (!member) {
    return NextResponse.json(
      { error: t(locale, "Mitglied nicht gefunden", "Member not found") },
      { status: 404 }
    );
  }

  const langCode = parsed.data.langCode?.toLowerCase() || null;
  if (langCode) {
    const language = await db.projectLanguage.findUnique({
      where: { projectId_langCode: { projectId: projektId, langCode } },
    });

    if (!language?.isActive) {
      return NextResponse.json(
        { error: t(locale, "Diese Sprache ist nicht aktiv", "This language is not active") },
        { status: 400 }
      );
    }
  }

  const changesLanguage = Object.prototype.hasOwnProperty.call(
    parsed.data,
    "langCode"
  );
  const updated = await db.$transaction(async (tx) => {
    // A language-scoped member must not retain assignments outside their new
    // scope. Reset those segments atomically before updating the membership.
    if (changesLanguage && langCode) {
      await resetProjectMemberWorkflowAssignments(tx, {
        projectId: projektId,
        memberId: member.id,
        exceptLangCode: langCode,
      });
    }

    return tx.projectMember.update({
      where: { id: member.id },
      data: {
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
        ...(changesLanguage ? { langCode } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });
  });

  return NextResponse.json({ member: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projektId: string; memberId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId, memberId } = await params;

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

  const member = await db.projectMember.findFirst({
    where: { id: memberId, projectId: projektId },
  });

  if (!member) {
    return NextResponse.json(
      { error: t(locale, "Mitglied nicht gefunden", "Member not found") },
      { status: 404 }
    );
  }

  await db.$transaction(async (tx) => {
    await resetProjectMemberWorkflowAssignments(tx, {
      projectId: projektId,
      memberId: member.id,
    });
    await tx.projectMember.delete({ where: { id: member.id } });
  });

  return NextResponse.json({ ok: true });
}
