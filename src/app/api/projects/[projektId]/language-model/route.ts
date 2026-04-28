import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";
import { encryptSecret } from "@/lib/secret-encryption";
import {
  TRANSLATION_PROVIDERS,
  getProviderLabel,
  getRecommendedModels,
  normalizeTranslationProvider,
  resolveTranslationProviderConfig,
} from "@/lib/translation-config";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

async function verifyProjectAccess(userId: string, projectId: string) {
  return db.project.findFirst({
    where: {
      id: projectId,
      organization: { members: { some: { userId } } },
    },
    include: { settings: true },
  });
}

function serializeSettings(settings: {
  translationProvider?: string | null;
  translationModel?: string | null;
  translationBaseUrl?: string | null;
  translationApiKeyEncrypted?: string | null;
} | null) {
  return {
    provider: settings?.translationProvider ?? null,
    model: settings?.translationModel ?? null,
    baseUrl: settings?.translationBaseUrl ?? null,
    hasProjectApiKey: Boolean(settings?.translationApiKeyEncrypted),
  };
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
  const project = await verifyProjectAccess(session.user.id, projektId);
  if (!project) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const effective = resolveTranslationProviderConfig({
    settings: project.settings,
  });

  return NextResponse.json({
    settings: serializeSettings(project.settings),
    effective: {
      provider: effective.provider,
      providerLabel: getProviderLabel(effective.provider),
      model: effective.model ?? null,
      baseUrl: effective.baseUrl ?? null,
      hasApiKey: Boolean(effective.apiKey),
    },
    providers: TRANSLATION_PROVIDERS.map((provider) => ({
      id: provider,
      label: getProviderLabel(provider),
      recommendedModels: getRecommendedModels(provider),
    })),
  });
}

const patchSchema = z.object({
  provider: z.string().trim().nullable().optional(),
  model: z.string().trim().max(160).nullable().optional(),
  baseUrl: z.string().trim().max(300).nullable().optional(),
  apiKey: z.string().trim().max(1000).optional(),
  apiKeyAction: z.enum(["keep", "clear"]).optional(),
});

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
  const project = await verifyProjectAccess(session.user.id, projektId);
  if (!project) {
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

  const nextProvider = provider ?? null;
  const nextModel = body.model || null;
  const nextBaseUrl = body.baseUrl || null;
  const data: {
    translationProvider: string | null;
    translationModel: string | null;
    translationBaseUrl: string | null;
    translationApiKeyEncrypted?: string | null;
    translationApiKeyUpdatedAt?: Date | null;
  } = {
    translationProvider: nextProvider,
    translationModel: nextModel,
    translationBaseUrl: nextBaseUrl,
  };

  if (body.apiKey) {
    data.translationApiKeyEncrypted = encryptSecret(body.apiKey);
    data.translationApiKeyUpdatedAt = new Date();
  } else if (body.apiKeyAction === "clear") {
    data.translationApiKeyEncrypted = null;
    data.translationApiKeyUpdatedAt = null;
  }

  const settings = await db.projectSettings.upsert({
    where: { projectId: project.id },
    create: {
      projectId: project.id,
      ...data,
    },
    update: data,
  });
  const effective = resolveTranslationProviderConfig({ settings });

  return NextResponse.json({
    settings: serializeSettings(settings),
    effective: {
      provider: effective.provider,
      providerLabel: getProviderLabel(effective.provider),
      model: effective.model ?? null,
      baseUrl: effective.baseUrl ?? null,
      hasApiKey: Boolean(effective.apiKey),
    },
  });
}
