import { NextRequest, NextResponse } from "next/server";
import { canAccessProject, canManageProject, getAuthenticatedUserId, getProjectAccess } from "@/lib/project-access";
import { listTranslationHistory, translationHistoryQuerySchema } from "@/lib/translation-history";
import { TranslationWorkflowError } from "@/lib/translation-workflow";

export async function GET(request: NextRequest, { params }: {
  params: Promise<{ projektId: string; translationId: string }>;
}) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { projektId, translationId } = await params;
  const access = await getProjectAccess(userId, projektId);
  if (!access || !canAccessProject(access)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const parsed = translationHistoryQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid history query" }, { status: 400 });
  try {
    const result = await listTranslationHistory({
      projectId: projektId, translationId,
      actor: { canManage: canManageProject(access), projectMemberId: null, langCode: access.langCode ?? null },
      ...parsed.data,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof TranslationWorkflowError) return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 400 },
    );
    console.error("[translation-history] list failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
