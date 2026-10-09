import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessProject, getAuthenticatedUserId, getProjectAccess } from "@/lib/project-access";
import { previewWorkspaceAi, runWorkspaceAi } from "@/lib/translation-ai-workflow";
import { TranslationWorkflowError } from "@/lib/translation-workflow";

const schema = z.object({
  mode: z.enum(["preview", "run"]),
  action: z.enum(["improve", "rephrase", "shorten"]),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  previewExpiresAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((value, context) => {
  if (value.mode === "run" && (!value.fingerprint || !value.previewExpiresAt))
    context.addIssue({ code: "custom", path: ["fingerprint"], message: "Preview is required." });
});

export async function POST(request: NextRequest, { params }: {
  params: Promise<{ projektId: string; translationId: string }>;
}) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { projektId, translationId } = await params;
  const access = await getProjectAccess(userId, projektId);
  if (!access || !canAccessProject(access))
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid AI suggestion request" }, { status: 400 });
  const input = { projectId: projektId, translationId, userId,
    expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt), action: parsed.data.action };
  try {
    const result = parsed.data.mode === "preview"
      ? await previewWorkspaceAi(input)
      : await runWorkspaceAi({ ...input, fingerprint: parsed.data.fingerprint!,
          previewExpiresAt: new Date(parsed.data.previewExpiresAt!) });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (!(error instanceof TranslationWorkflowError)) {
      console.error("[translation-ai-suggestion] failed:", error);
      return NextResponse.json({ error: "AI suggestion unavailable" }, { status: 503 });
    }
    const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 :
      error.code === "STALE_UPDATE" || error.code === "INVALID_TRANSITION" ? 409 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
}
