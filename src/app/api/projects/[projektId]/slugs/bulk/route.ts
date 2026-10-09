import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthenticatedUserId, userCanManageProject, canManageProjectForWrite } from "@/lib/project-access";
import { isProjectRuntimeSerializationConflict, lockAndValidateProjectLanguageWrite } from "@/lib/project-runtime-configuration-lock";

const schema = z.object({
  action: z.literal("reset"),
  rows: z.array(z.object({ id: z.string().min(1), updatedAt: z.iso.datetime() }).strict()).min(1).max(100),
}).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ projektId: string }> }) {
  const userId = await getAuthenticatedUserId();
  const { projektId } = await params;
  if (!userId) return NextResponse.json({ code: "unauthenticated" }, { status: 401 });
  if (!(await userCanManageProject(userId, projektId))) return NextResponse.json({ code: "not_found" }, { status: 404 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success || new Set(input.data.rows.map((row) => row.id)).size !== input.data.rows.length) {
    return NextResponse.json({ code: "invalid_input" }, { status: 400 });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const count = await db.$transaction(async (tx) => {
        if (!(await canManageProjectForWrite(tx, userId, projektId))) throw new Error("not_found");
        const rows = await tx.urlSlug.findMany({
          where: { projectId: projektId, id: { in: input.data.rows.map((row) => row.id) } },
          select: { id: true, langTo: true, translatedSlug: true, updatedAt: true },
        });
        if (rows.length !== input.data.rows.length) throw new Error("not_found");
        if (!(await lockAndValidateProjectLanguageWrite(tx, {
          projectId: projektId, targetLanguages: rows.map((row) => row.langTo),
        }))) throw new Error("inactive_language");
        for (const selected of input.data.rows) {
          const current = rows.find((row) => row.id === selected.id);
          if (!current || current.updatedAt.getTime() !== new Date(selected.updatedAt).getTime()) throw new Error("stale_slug");
        }
        for (const selected of input.data.rows.filter((row) => rows.some((current) => current.id === row.id && current.translatedSlug !== null))) {
          const result = await tx.urlSlug.updateMany({
            where: { id: selected.id, projectId: projektId, updatedAt: new Date(selected.updatedAt) },
            data: { translatedSlug: null },
          });
          if (result.count !== 1) throw new Error("stale_slug");
        }
        return rows.filter((row) => row.translatedSlug !== null).length;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return NextResponse.json({ count });
    } catch (error) {
      if (isProjectRuntimeSerializationConflict(error) && attempt < 2) continue;
      const code = error instanceof Error ? error.message : "";
      if (code === "not_found") return NextResponse.json({ code }, { status: 404 });
      if (code === "stale_slug" || code === "inactive_language" || isProjectRuntimeSerializationConflict(error)) {
        return NextResponse.json({ code: code === "stale_slug" || code === "inactive_language" ? code : "concurrent_change" }, { status: 409 });
      }
      console.error("[POST /api/projects/:projektId/slugs/bulk] Failed:", error);
      return NextResponse.json({ code: "save_failed" }, { status: 500 });
    }
  }
  return NextResponse.json({ code: "concurrent_change" }, { status: 409 });
}
