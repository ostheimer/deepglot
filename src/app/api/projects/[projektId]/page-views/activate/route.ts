import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendProjectAuditEvent } from "@/lib/audit-events";
import { userCanManageProject, canManageProjectForWrite } from "@/lib/project-access";

import { getCookieLocale } from "@/lib/request-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

export async function POST(
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

  const consentGrantedAt = new Date();

  const changed = await db.$transaction(async (tx) => {
    if (!(await canManageProjectForWrite(tx, session.user.id!, projektId))) return false;
    await tx.projectSettings.upsert({

    where: { projectId: projektId },
    create: {
      projectId: projektId,
      pageViewsEnabled: true,
      pageViewsConsentGrantedAt: consentGrantedAt,
    },
    update: {
      pageViewsEnabled: true,
      pageViewsConsentGrantedAt: consentGrantedAt,
    },
    });
    await appendProjectAuditEvent(tx, { projectId: projektId, actorUserId: session.user.id!, action: "project.page_views_enabled", category: "project" });
    return true;
  });
  if (!changed) return NextResponse.json({ error: t(locale, "Projekt nicht gefunden", "Project not found") }, { status: 404 });


  return NextResponse.json({ success: true });
}

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

  const changed = await db.$transaction(async (tx) => {
    if (!(await canManageProjectForWrite(tx, session.user.id!, projektId))) return false;
    await tx.projectSettings.upsert({

    where: { projectId: projektId },
    create: {
      projectId: projektId,
      pageViewsEnabled: false,
      pageViewsConsentGrantedAt: null,
    },
    update: { pageViewsEnabled: false, pageViewsConsentGrantedAt: null },
    });
    await appendProjectAuditEvent(tx, { projectId: projektId, actorUserId: session.user.id!, action: "project.page_views_disabled", category: "project" });
    return true;
  });
  if (!changed) return NextResponse.json({ error: t(locale, "Projekt nicht gefunden", "Project not found") }, { status: 404 });


  return NextResponse.json({ success: true });
}
