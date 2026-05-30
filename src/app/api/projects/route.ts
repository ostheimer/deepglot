import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";
import { generateApiKey } from "@/lib/api-keys";
import { getProjectsLimitForPlan } from "@/lib/billing-plans";
import { z } from "zod";
import { uiText } from "@/lib/static-copy";
import type { SiteLocale } from "@/lib/site-locale";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
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

    const currentProjects = await db.project.count({
      where: { organizationId: membership.organizationId },
    });

    const limit = getProjectsLimitForPlan(membership.organization.plan);
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

    // Automatically create a default API key so the user can start using the
    // plugin immediately without an extra step.
    const defaultKeyName = uiText(locale, "WordPress plugin", "WordPress Plugin");
    const { rawKey, apiKey } = await generateApiKey({
      projectId: project.id,
      name: defaultKeyName,
    });

    return NextResponse.json(
      { projectId: project.id, rawKey, keyName: apiKey.name },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/projects] Fehler:", error);
    return NextResponse.json(
      { error: t(locale, "Projekt konnte nicht erstellt werden", "Could not create project") },
      { status: 500 }
    );
  }
}
