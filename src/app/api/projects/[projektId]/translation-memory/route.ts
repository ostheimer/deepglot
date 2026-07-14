import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userCanManageProject } from "@/lib/project-access";
import { planSupportsTranslationMemory } from "@/lib/translation-memory";

const patchSchema = z.object({ enabled: z.boolean() });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  const { projektId } = await params;
  if (!(await userCanManageProject(session.user.id, projektId))) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  const project = await db.project.findUnique({
    where: { id: projektId },
    select: { organization: { select: { plan: true } } },
  });
  if (!project) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  if (
    parsed.data.enabled &&
    !planSupportsTranslationMemory(project.organization.plan)
  ) {
    return NextResponse.json(
      { error: "Das Übersetzungsgedächtnis ist ab dem Pro-Plan verfügbar." },
      { status: 403 }
    );
  }

  const settings = await db.projectSettings.upsert({
    where: { projectId: projektId },
    create: { projectId: projektId, translationMemory: parsed.data.enabled },
    update: { translationMemory: parsed.data.enabled },
    select: { translationMemory: true },
  });

  return NextResponse.json({ enabled: settings.translationMemory });
}
