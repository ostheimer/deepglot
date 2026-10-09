import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { canAccessProject, canManageProject, getAuthenticatedUserId, getProjectAccess } from "@/lib/project-access";
import { MAX_WORKSPACE_REPLACE_ITEMS } from "@/lib/translation-search-replace";
import { applyWorkspaceReplacement, previewWorkspaceReplacement } from "@/lib/translation-search-replace-workflow";
import { TranslationWorkflowError } from "@/lib/translation-workflow";

const schema = z.object({
  mode: z.enum(["preview", "apply"]),
  items: z.array(z.object({ id: z.string().min(1), expectedUpdatedAt: z.string().datetime({ offset: true }) }).strict())
    .min(1).max(MAX_WORKSPACE_REPLACE_ITEMS),
  find: z.string().min(1).max(200),
  replace: z.string().max(200),
  includeReviewed: z.boolean().optional(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict().superRefine((value, context) => {
  if (value.mode === "apply" && !value.fingerprint)
    context.addIssue({ code: "custom", path: ["fingerprint"], message: "Preview is required." });
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ projektId: string }> }) {
  const userId = await getAuthenticatedUserId();
  const { projektId } = await params;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const access = await getProjectAccess(userId, projektId);
  if (!access || !canAccessProject(access))
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid search and replace request" }, { status: 400 });
  const member = await db.projectMember.findFirst({ where: { projectId: projektId, userId }, select: { id: true } });
  const input = {
    projectId: projektId, userId,
    actor: { canManage: canManageProject(access), projectMemberId: member?.id ?? null,
      langCode: access.langCode ?? null },
    items: parsed.data.items.map((item) => ({ id: item.id, expectedUpdatedAt: new Date(item.expectedUpdatedAt) })),
    find: parsed.data.find, replace: parsed.data.replace,
    includeReviewed: parsed.data.includeReviewed === true,
  };
  try {
    const result = parsed.data.mode === "preview"
      ? await previewWorkspaceReplacement(input)
      : await applyWorkspaceReplacement({ ...input, fingerprint: parsed.data.fingerprint! });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (!(error instanceof TranslationWorkflowError)) {
      console.error("[translation-search-replace] failed:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 :
      error.code === "STALE_UPDATE" || error.code === "INVALID_TRANSITION" ? 409 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
}
