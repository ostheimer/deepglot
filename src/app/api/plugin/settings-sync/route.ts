import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { validateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import {
  pluginSettingsSyncSchema,
  type PluginSettingsSyncPayload,
} from "@/lib/plugin-settings-sync";
import {
  PLUGIN_RATE_LIMIT_SCOPE,
  buildRateLimitHeaders,
  consumeRateLimit,
  getRateLimitConfig,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

function getRawApiKey(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const queryApiKey = searchParams.get("api_key");
  const authHeader = request.headers.get("authorization");
  const bearerKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  return queryApiKey ?? bearerKey;
}

function getSourceHost(payload: PluginSettingsSyncPayload) {
  if (!payload.siteUrl) {
    return null;
  }

  try {
    return new URL(payload.siteUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const rawApiKey = getRawApiKey(request);

  if (!rawApiKey) {
    return NextResponse.json(
      { error: "Missing API key." },
      { status: 401 }
    );
  }

  const apiKey = await validateApiKey(rawApiKey);

  if (!apiKey) {
    return NextResponse.json(
      { error: "Invalid or expired API key." },
      { status: 401 }
    );
  }

  const rateLimit = await consumeRateLimit({
    scope: PLUGIN_RATE_LIMIT_SCOPE,
    subject: apiKey.id,
    limit: getRateLimitConfig().pluginPerMinute,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: `Rate limit exceeded. Maximum ${rateLimit.limit} plugin requests per minute.`,
      },
      { status: 429, headers: buildRateLimitHeaders(rateLimit) }
    );
  }

  const payload = pluginSettingsSyncSchema.safeParse(await request.json());

  if (!payload.success) {
    return NextResponse.json(
      {
        error:
          payload.error.issues[0]?.message ?? "Invalid settings sync payload.",
      },
      { status: 400 }
    );
  }

  const body = payload.data;
  const domainMappingLanguages = new Set(
    body.domainMappings.map((mapping) => mapping.langCode)
  );
  const duplicateHosts = new Set<string>();
  const seenHosts = new Set<string>();

  body.domainMappings.forEach((mapping) => {
    if (seenHosts.has(mapping.host)) {
      duplicateHosts.add(mapping.host);
      return;
    }
    seenHosts.add(mapping.host);
  });

  if (duplicateHosts.size > 0) {
    return NextResponse.json(
      { error: "Domain mappings must use unique hosts." },
      { status: 400 }
    );
  }

  const invalidMapping = body.domainMappings.find(
    (mapping) => !body.targetLanguages.includes(mapping.langCode)
  );

  if (invalidMapping) {
    return NextResponse.json(
      {
        error: `Domain mapping language '${invalidMapping.langCode}' is not active for the project.`,
      },
      { status: 400 }
    );
  }

  if (
    body.routingMode === "SUBDOMAIN" &&
    body.targetLanguages.some((language) => !domainMappingLanguages.has(language))
  ) {
    return NextResponse.json(
      {
        error:
          "Every active target language needs a domain mapping before subdomain routing can be enabled.",
      },
      { status: 400 }
    );
  }

  try {
    const sourceHost = getSourceHost(body);
    const projectId = apiKey.project.id;
    const synced = await db.$transaction(
      async (tx) => {
        const project = await tx.project.update({
          where: { id: projectId },
          data: {
            originalLang: body.sourceLanguage,
            ...(sourceHost ? { domain: sourceHost } : {}),
          },
        });

        const existingLanguages = await tx.projectLanguage.findMany({
          where: { projectId },
          select: { id: true, langCode: true },
        });

        const existingLanguageCodes = new Set(
          existingLanguages.map((language) => language.langCode)
        );

        if (body.targetLanguages.length > 0) {
          await tx.projectLanguage.updateMany({
            where: { projectId },
            data: { isActive: false },
          });
        }

        for (const language of body.targetLanguages) {
          if (existingLanguageCodes.has(language)) {
            await tx.projectLanguage.updateMany({
              where: { projectId, langCode: language },
              data: { isActive: true },
            });
          } else {
            await tx.projectLanguage.create({
              data: {
                projectId,
                langCode: language,
                isActive: true,
              },
            });
          }
        }

        await tx.projectSettings.upsert({
          where: { projectId },
          create: {
            projectId,
            autoSwitch: body.autoRedirect,
            translateEmails: body.translateEmails,
            translateSearch: body.translateSearch,
            translateAmp: body.translateAmp,
            routingMode: body.routingMode,
            runtimeSyncedAt: new Date(),
          },
          update: {
            autoSwitch: body.autoRedirect,
            translateEmails: body.translateEmails,
            translateSearch: body.translateSearch,
            translateAmp: body.translateAmp,
            routingMode: body.routingMode,
            runtimeSyncedAt: new Date(),
          },
        });

        await tx.projectDomainMapping.deleteMany({
          where: { projectId },
        });

        if (body.domainMappings.length > 0) {
          await tx.projectDomainMapping.createMany({
            data: body.domainMappings.map((mapping) => ({
              projectId,
              langCode: mapping.langCode,
              host: mapping.host,
            })),
          });
        }

        return tx.project.findUnique({
          where: { id: project.id },
          include: {
            settings: true,
            domainMappings: {
              orderBy: { langCode: "asc" },
            },
            languages: {
              orderBy: { langCode: "asc" },
            },
          },
        });
      }
    );

    return NextResponse.json({
      ok: true,
      project: synced,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A domain mapping host is already connected to another project." },
        { status: 409 }
      );
    }

    console.error("[POST /api/plugin/settings-sync] Failed:", error);

    return NextResponse.json(
      { error: "Could not sync plugin settings." },
      { status: 500 }
    );
  }
}
