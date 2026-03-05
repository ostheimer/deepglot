import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const createProjectSchema = z.object({
  name: z.string().min(2, "Projektname muss mindestens 2 Zeichen haben"),
  domain: z.string().min(3, "Ungültige Domain"),
  originalLang: z.string().length(2, "Ungültiger Sprachcode"),
  languages: z.array(z.string().length(2)).min(1, "Mindestens eine Übersetzungssprache erforderlich"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = createProjectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" },
        { status: 400 }
      );
    }

    const { name, domain, originalLang, languages } = parsed.data;

    // Find user's organization
    const membership = await db.organizationMember.findFirst({
      where: { userId: session.user.id },
      include: { organization: { include: { subscription: true } } },
    });

    if (!membership) {
      return NextResponse.json({ error: "Organisation nicht gefunden" }, { status: 404 });
    }

    // Check project limit based on plan
    const planLimits: Record<string, number> = {
      FREE: 1,
      STARTER: 5,
      PROFESSIONAL: 999,
      ENTERPRISE: 999,
    };

    const currentProjects = await db.project.count({
      where: { organizationId: membership.organizationId },
    });

    const limit = planLimits[membership.organization.plan] ?? 1;
    if (currentProjects >= limit) {
      return NextResponse.json(
        {
          error: `Dein ${membership.organization.plan}-Plan erlaubt maximal ${limit} Projekt${limit > 1 ? "e" : ""}. Bitte upgrade deinen Plan.`,
        },
        { status: 403 }
      );
    }

    // Create project with languages in a transaction
    const project = await db.$transaction(async (tx) => {
      const newProject = await tx.project.create({
        data: {
          name,
          domain,
          originalLang,
          organizationId: membership.organizationId,
        },
      });

      await tx.projectLanguage.createMany({
        data: languages.map((langCode) => ({
          projectId: newProject.id,
          langCode,
          isActive: true,
        })),
      });

      return newProject;
    });

    return NextResponse.json({ projectId: project.id }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/projects] Fehler:", error);
    return NextResponse.json({ error: "Projekt konnte nicht erstellt werden" }, { status: 500 });
  }
}
