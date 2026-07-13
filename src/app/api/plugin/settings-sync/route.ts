import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { validateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { apiProblem, validationProblem } from "@/lib/problem-details";
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

async function syncPluginSettings(request: NextRequest) {
  const rawApiKey = getRawApiKey(request);

  if (!rawApiKey) {
    return apiProblem({
      status: 401,
      title: "Authentication required",
      detail: "Missing API key.",
      code: "missing_api_key",
      instance: "/api/plugin/settings-sync",
    });
  }

  const apiKey = await validateApiKey(rawApiKey);

  if (!apiKey) {
    return apiProblem({
      status: 401,
      title: "Authentication failed",
      detail: "Invalid or expired API key.",
      code: "invalid_api_key",
      instance: "/api/plugin/settings-sync",
    });
  }

  const rateLimit = await consumeRateLimit({
    scope: PLUGIN_RATE_LIMIT_SCOPE,
    subject: apiKey.id,
    limit: getRateLimitConfig().pluginPerMinute,
  });

  if (!rateLimit.allowed) {
    return apiProblem({
      status: 429,
      title: "Rate limit exceeded",
      detail: `Rate limit exceeded. Maximum ${rateLimit.limit} plugin requests per minute.`,
      code: "rate_limit_exceeded",
      instance: "/api/plugin/settings-sync",
      extensions: { retry_after: rateLimit.retryAfterSeconds },
      headers: buildRateLimitHeaders(rateLimit),
    });
  }

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return validationProblem({
      detail: "Request body must be valid JSON.",
      instance: "/api/plugin/settings-sync",
      errors: { body: ["Invalid JSON"] },
    });
  }

  const payload = pluginSettingsSyncSchema.safeParse(requestBody);

  if (!payload.success) {
    const errors = payload.error.issues.reduce<Record<string, string[]>>(
      (fieldErrors, issue) => {
        const field = issue.path.join(".") || "body";
        fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message];
        return fieldErrors;
      },
      {},
    );

    return validationProblem({
      detail:
        payload.error.issues[0]?.message ?? "Invalid settings sync payload.",
      instance: "/api/plugin/settings-sync",
      errors,
    });
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
    return validationProblem({
      detail: "Domain mappings must use unique hosts.",
      instance: "/api/plugin/settings-sync",
      errors: { domainMappings: ["Hosts must be unique."] },
    });
  }

  const invalidMapping = body.domainMappings.find(
    (mapping) => !body.targetLanguages.includes(mapping.langCode)
  );

  if (invalidMapping) {
    return validationProblem({
      detail: `Domain mapping language '${invalidMapping.langCode}' is not active for the project.`,
      instance: "/api/plugin/settings-sync",
      errors: {
        domainMappings: ["Every mapping language must be an active target language."],
      },
    });
  }

  if (
    body.routingMode === "SUBDOMAIN" &&
    body.targetLanguages.some((language) => !domainMappingLanguages.has(language))
  ) {
    return validationProblem({
      detail:
        "Every active target language needs a domain mapping before subdomain routing can be enabled.",
      instance: "/api/plugin/settings-sync",
      errors: {
        domainMappings: ["A mapping is required for every active target language."],
      },
    });
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
      return apiProblem({
        status: 409,
        title: "Conflict",
        detail: "A domain mapping host is already connected to another project.",
        code: "domain_mapping_conflict",
        instance: "/api/plugin/settings-sync",
      });
    }

    console.error("[POST /api/plugin/settings-sync] Failed:", error);

    return apiProblem({
      status: 500,
      title: "Internal server error",
      detail: "Could not sync plugin settings.",
      code: "internal_error",
      instance: "/api/plugin/settings-sync",
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    return await syncPluginSettings(request);
  } catch (error) {
    console.error("[POST /api/plugin/settings-sync] Failed before sync:", error);
    return apiProblem({
      status: 500,
      title: "Internal server error",
      detail: "Could not sync plugin settings.",
      code: "internal_error",
      instance: "/api/plugin/settings-sync",
    });
  }
}
