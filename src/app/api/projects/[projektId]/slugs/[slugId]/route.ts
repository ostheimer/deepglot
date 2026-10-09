import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getAuthenticatedUserId, userCanManageProject, canManageProjectForWrite } from "@/lib/project-access";
import {
  isProjectRuntimeSerializationConflict,
  lockAndValidateProjectLanguageWrite,
  lockProjectRuntimeConfiguration,
} from "@/lib/project-runtime-configuration-lock";
import { UrlSlugEditError, validateUrlSlugEdit } from "@/lib/url-slug-edit";

const patchSchema = z.object({
  translatedSlug: z.string().max(600).nullable(),
  updatedAt: z.iso.datetime(),
}).strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string; slugId: string }> },
) {
  const userId = await getAuthenticatedUserId();
  const { projektId, slugId } = await params;
  if (!userId) return NextResponse.json({ code: "unauthenticated" }, { status: 401 });
  if (!(await userCanManageProject(userId, projektId))) {
    return NextResponse.json({ code: "not_found" }, { status: 404 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "invalid_input" }, { status: 400 });
  const expectedUpdatedAt = new Date(parsed.data.updatedAt);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const slug = await db.$transaction(async (tx) => {
        if (!(await lockProjectRuntimeConfiguration(tx, projektId))) throw new Error("not_found");
        if (!(await canManageProjectForWrite(tx, userId, projektId))) throw new Error("not_found");
        const existing = await tx.urlSlug.findFirst({
          where: { id: slugId, projectId: projektId },
          select: { id: true, originalSlug: true, translatedSlug: true, langTo: true, updatedAt: true },
        });
        if (!existing) throw new Error("not_found");
        if (!(await lockAndValidateProjectLanguageWrite(tx, {
          projectId: projektId,
          targetLanguages: [existing.langTo],
        }))) throw new Error("inactive_language");
        if (existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new Error("stale_slug");

        const rows = await tx.urlSlug.findMany({
          where: { projectId: projektId, langTo: { equals: existing.langTo, mode: "insensitive" } },
          select: { id: true, originalSlug: true, translatedSlug: true, langTo: true },
        });
        const translatedSlug = validateUrlSlugEdit(parsed.data.translatedSlug, slugId, rows);
        const changed = await tx.urlSlug.updateMany({
          where: { id: slugId, projectId: projektId, updatedAt: expectedUpdatedAt },
          data: { translatedSlug },
        });
        if (changed.count !== 1) throw new Error("stale_slug");
        return tx.urlSlug.findUniqueOrThrow({
          where: { id: slugId },
          select: { id: true, translatedSlug: true, updatedAt: true },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return NextResponse.json({ slug });
    } catch (error) {
      if (isProjectRuntimeSerializationConflict(error) && attempt < 2) continue;
      if (error instanceof UrlSlugEditError) {
        return NextResponse.json({ code: error.code }, { status: error.code === "slug_collision" ? 409 : 400 });
      }
      if (error instanceof Error && error.message === "not_found") {
        return NextResponse.json({ code: "not_found" }, { status: 404 });
      }
      if (error instanceof Error && error.message === "inactive_language") {
        return NextResponse.json({ code: "inactive_language" }, { status: 409 });
      }
      if (error instanceof Error && error.message === "stale_slug") {
        return NextResponse.json({ code: "stale_slug" }, { status: 409 });
      }
      if (isProjectRuntimeSerializationConflict(error)) {
        return NextResponse.json({ code: "concurrent_change" }, { status: 409 });
      }
      console.error("[PATCH /api/projects/:projektId/slugs/:slugId] Failed:", error);
      return NextResponse.json({ code: "save_failed" }, { status: 500 });
    }
  }
  return NextResponse.json({ code: "concurrent_change" }, { status: 409 });
}
