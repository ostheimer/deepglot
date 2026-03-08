import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";
import { z } from "zod";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

export async function POST(req: NextRequest) {
  const locale = await getCookieLocale();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  try {
    const createProjectSchema = z.object({
      name: z.string().min(2, t(locale, "Projektname muss mindestens 2 Zeichen haben", "Project name must be at least 2 characters long")),
      domain: z.string().min(3, t(locale, "Ungültige Domain", "Invalid domain")),
      originalLang: z.string().length(2, t(locale, "Ungültiger Sprachcode", "Invalid language code")),
      languages: z
        .array(z.string().length(2))
        .min(1, t(locale, "Mindestens eine Übersetzungssprache erforderlich", "At least one translation language is required")),
    });
    const body = await req.json();
    const parsed = createProjectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ??
            t(locale, "Ungültige Eingabe", "Invalid input"),
        },
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
      return NextResponse.json(
        { error: t(locale, "Organisation nicht gefunden", "Organization not found") },
        { status: 404 }
      );
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
          error:
            locale === "de"
              ? `Dein ${membership.organization.plan}-Plan erlaubt maximal ${limit} Projekt${limit > 1 ? "e" : ""}. Bitte upgrade deinen Plan.`
              : `Your ${membership.organization.plan} plan allows up to ${limit} project${limit > 1 ? "s" : ""}. Please upgrade your plan.`,
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
    return NextResponse.json(
      { error: t(locale, "Projekt konnte nicht erstellt werden", "Could not create project") },
      { status: 500 }
    );
  }
}
