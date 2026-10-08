import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { serializeExclusionCsv } from "@/lib/exclusion-csv";
import { getAuthenticatedUserId, userCanManageProject } from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId } = await params;
  if (!userId) return NextResponse.json({ error: uiText(locale, "Not authenticated", "Nicht authentifiziert") }, { status: 401 });
  if (!(await userCanManageProject(userId, projektId))) {
    return NextResponse.json({ error: uiText(locale, "Project not found", "Projekt nicht gefunden") }, { status: 404 });
  }
  const rules = await db.translationExclusion.findMany({
    where: { projectId: projektId },
    orderBy: [{ type: "asc" }, { value: "asc" }],
    select: { type: true, value: true },
  });
  return new Response(serializeExclusionCsv(rules), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="deepglot-exclusions.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
