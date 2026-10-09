import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { fetchProjectPreview, VisualPreviewError } from "@/lib/exclusion-visual";
import { getAuthenticatedUserId, userCanManageProject } from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const locale = await getCookieLocale();
  const t = (en: string, de: string) => uiText(locale, en, de);
  const userId = await getAuthenticatedUserId();
  const { projektId } = await params;
  if (!userId) return NextResponse.json({ error: t("Not authenticated", "Nicht authentifiziert") }, { status: 401 });
  if (!(await userCanManageProject(userId, projektId))) {
    return NextResponse.json({ error: t("Project not found", "Projekt nicht gefunden") }, { status: 404 });
  }
  const body = await request.json().catch(() => null) as { path?: unknown } | null;
  if (typeof body?.path !== "string" || body.path.length > 1536) {
    return NextResponse.json({ error: t("Invalid path", "Ungültiger Pfad") }, { status: 400 });
  }
  const project = await db.project.findUnique({ where: { id: projektId }, select: { domain: true } });
  if (!project) return NextResponse.json({ error: t("Project not found", "Projekt nicht gefunden") }, { status: 404 });
  try {
    const preview = await fetchProjectPreview(project.domain, body.path);
    return NextResponse.json(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error instanceof VisualPreviewError ? error.message : "";
    return NextResponse.json({ error: t(
      detail || "Page preview unavailable",
      detail === "Enter a path on this project" || detail === "Path is outside this project"
        ? "Gib einen Pfad auf diesem Projekt ein"
        : detail === "Page exceeds the 1 MiB preview limit"
          ? "Die Seite überschreitet das Vorschaulimit von 1 MiB"
          : detail === "Page preview timed out"
            ? "Zeitlimit beim Laden der Seitenvorschau erreicht"
            : "Seitenvorschau nicht verfügbar: Nur öffentliche HTML-Seiten ohne Weiterleitung werden unterstützt"
    ) }, { status: 422 });
  }
}
