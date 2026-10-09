import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userCanManageProject, canManageProjectForWrite } from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";
import { encryptSecret } from "@/lib/secret-encryption";
import { suggestWebsiteDescription } from "@/lib/translation-context-settings";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";
import {
  normalizeTranslationProvider,
  resolveTranslationProviderConfig,
  serializeLanguageModelApiResponse,
} from "@/lib/translation-config";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const locale = await getCookieLocale();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  const { projektId } = await params;
  if (!(await userCanManageProject(session.user.id, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const settings = await db.projectSettings.findUnique({
    where: { projectId: projektId },
  });
  const effective = resolveTranslationProviderConfig({
    settings,
  });

  return NextResponse.json(
    serializeLanguageModelApiResponse({
      settings,
      effective,
      includeProviders: true,
    })
  );
}

const patchSchema = z.object({
  provider: z.string().trim().nullable().optional(),
  model: z.string().trim().max(160).nullable().optional(),
  baseUrl: z.string().trim().max(300).nullable().optional(),
  apiKey: z.string().trim().max(1000).optional(),
  apiKeyAction: z.enum(["keep", "clear"]).optional(),
  websiteDescription: z.string().trim().max(1200).nullable().optional(),
  translationTone: z.string().trim().max(160).nullable().optional(),
  translationAudience: z.string().trim().max(300).nullable().optional(),
  translationInstructions: z.string().trim().max(1000).nullable().optional(),
  useGlossaryAsContext: z.boolean().optional(),
  useApprovedTranslationsAsContext: z.boolean().optional(),
});

// A user-triggered local suggestion only. No provider call and no database write.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const locale = await getCookieLocale();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }
  const { projektId } = await params;
  if (!(await userCanManageProject(session.user.id, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }
  const project = await db.project.findUnique({
    where: { id: projektId },
    select: {
      name: true,
      domain: true,
      settings: { select: { websiteType: true, industryType: true } },
    },
  });
  if (!project) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }
  return NextResponse.json({
    suggestion: suggestWebsiteDescription({
      name: project.name,
      domain: project.domain,
      websiteType: project.settings?.websiteType,
      industryType: project.settings?.industryType,
      locale: locale === "de" ? "de" : "en",
    }),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const locale = await getCookieLocale();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  const { projektId } = await params;
  if (!(await userCanManageProject(session.user.id, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: t(locale, "Ungültige Eingabe", "Invalid input") },
      { status: 400 }
    );
  }

  const body = parsed.data;
  const provider = normalizeTranslationProvider(body.provider);
  if (body.provider && !provider) {
    return NextResponse.json(
      {
        error: t(
          locale,
          "Unbekannter Übersetzungsanbieter",
          "Unknown translation provider"
        ),
      },
      { status: 400 }
    );
  }

  const data: {
    translationProvider?: string | null;
    translationModel?: string | null;
    translationBaseUrl?: string | null;
    translationApiKeyEncrypted?: string | null;
    translationApiKeyUpdatedAt?: Date | null;
    websiteDescription?: string | null;
    translationTone?: string | null;
    translationAudience?: string | null;
    translationInstructions?: string | null;
    useGlossaryAsContext?: boolean;
    useApprovedTranslationsAsContext?: boolean;
  } = {};

  if (body.provider !== undefined) data.translationProvider = provider;
  if (body.model !== undefined) data.translationModel = body.model || null;
  if (body.baseUrl !== undefined) data.translationBaseUrl = body.baseUrl || null;

  for (const field of [
    "websiteDescription",
    "translationTone",
    "translationAudience",
    "translationInstructions",
  ] as const) {
    if (body[field] !== undefined) data[field] = body[field] || null;
  }
  if (body.useGlossaryAsContext !== undefined) {
    data.useGlossaryAsContext = body.useGlossaryAsContext;
  }
  if (body.useApprovedTranslationsAsContext !== undefined) {
    data.useApprovedTranslationsAsContext = body.useApprovedTranslationsAsContext;
  }

  if (body.apiKey) {
    data.translationApiKeyEncrypted = encryptSecret(body.apiKey);
    data.translationApiKeyUpdatedAt = new Date();
  } else if (body.apiKeyAction === "clear") {
    data.translationApiKeyEncrypted = null;
    data.translationApiKeyUpdatedAt = null;
  }

  const settings = await db.$transaction(async (tx) => {
    if (!(await canManageProjectForWrite(tx, session.user.id!, projektId))) return null;
    return tx.projectSettings.upsert({
      where: { projectId: projektId },
      create: { projectId: projektId, ...data },
      update: data,
    });
  });
  if (!settings) return NextResponse.json({ error: t(locale, "Projekt nicht gefunden", "Project not found") }, { status: 404 });
  const effective = resolveTranslationProviderConfig({ settings });

  return NextResponse.json(
    serializeLanguageModelApiResponse({ settings, effective })
  );
}
