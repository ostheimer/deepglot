import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { validateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { apiProblem, validationProblem } from "@/lib/problem-details";
import {
  buildPluginOwnedSettingsUpdate,
  buildRuntimeSyncMirrorRecord,
  findPluginMirrorConflicts,
  pluginSettingsSyncSchema,
  type PluginSettingsSyncPayload,
  validatePluginDomainMappings,
} from "@/lib/plugin-settings-sync";
import { lockProjectRuntimeConfiguration } from "@/lib/project-runtime-configuration-lock";
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

  try {
    const projectId = apiKey.project.id;
    const result = await db.$transaction(
      async (tx) => {
        if (!(await lockProjectRuntimeConfiguration(tx, projectId))) {
          return { kind: "not_found" } as const;
        }

        // The key was validated before the transaction; a manager may have
        // revoked it since. Re-check under the lock so a revoked key can
        // neither sync nor re-create the sync origin it just cleared.
        const liveKey = await tx.apiKey.findFirst({
          where: { id: apiKey.id, projectId, isActive: true },
          select: { id: true },
        });
        if (!liveKey) {
          return { kind: "key_revoked" } as const;
        }

        const authoritativeProject = await tx.project.findUnique({
          where: { id: projectId },
          select: {
            domain: true,
            originalLang: true,
            settings: {
              select: { autoSwitch: true },
            },
            languages: {
              select: { langCode: true, isActive: true },
            },
          },
        });
        if (!authoritativeProject) {
          return { kind: "not_found" } as const;
        }

        // Record who is talking to this project before any validation can
        // reject the payload: a foreign installation reusing the key must
        // become visible even when its mirrored settings are refused.
        const syncOrigin = {
          runtimeSyncSiteHost: getSourceHost(body),
          runtimeSyncApiKeyId: apiKey.id,
        };
        await tx.projectSettings.upsert({
          where: { projectId },
          create: { projectId, ...syncOrigin },
          update: syncOrigin,
        });

        const activeTargetLanguages = authoritativeProject.languages
          .filter((language) => language.isActive)
          .map((language) => language.langCode.toLowerCase());
        const domainMappingsValidation = validatePluginDomainMappings(
          body,
          activeTargetLanguages,
        );
        if (domainMappingsValidation) {
          return {
            kind: "invalid_domain_mappings",
            validation: domainMappingsValidation,
          } as const;
        }

        const mirrorConflicts = findPluginMirrorConflicts(body, {
          domain: authoritativeProject.domain,
          sourceLanguage: authoritativeProject.originalLang,
          targetLanguages: activeTargetLanguages,
          autoRedirect: authoritativeProject.settings?.autoSwitch ?? false,
        });
        const settingsUpdate = {
          ...buildPluginOwnedSettingsUpdate(body),
          ...buildRuntimeSyncMirrorRecord(body, mirrorConflicts),
          ...syncOrigin,
        };

        await tx.projectSettings.upsert({
          where: { projectId },
          create: {
            projectId,
            ...settingsUpdate,
          },
          update: settingsUpdate,
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

        const project = await tx.project.findUnique({
          where: { id: projectId },
          select: {
            id: true,
            name: true,
            domain: true,
            originalLang: true,
            updatedAt: true,
            settings: {
              select: {
                autoSwitch: true,
                displayAiNotice: true,
                automaticTranslation: true,
                websiteType: true,
                industryType: true,
                translateEmails: true,
                translateSearch: true,
                translateAmp: true,
                routingMode: true,
                runtimeSyncedAt: true,
              },
            },
            domainMappings: {
              orderBy: { langCode: "asc" },
              select: { langCode: true, host: true },
            },
            languages: {
              orderBy: { langCode: "asc" },
              select: { langCode: true, isActive: true },
            },
          },
        });

        return { kind: "synced", project, mirrorConflicts } as const;
      }
    );

    if (result.kind === "not_found") {
      return apiProblem({
        status: 404,
        title: "Project not found",
        detail: "The API key's project no longer exists.",
        code: "project_not_found",
        instance: "/api/plugin/settings-sync",
      });
    }

    if (result.kind === "key_revoked") {
      return apiProblem({
        status: 401,
        title: "Authentication required",
        detail: "The API key was revoked.",
        code: "invalid_api_key",
        instance: "/api/plugin/settings-sync",
      });
    }

    if (result.kind === "invalid_domain_mappings") {
      return validationProblem({
        instance: "/api/plugin/settings-sync",
        ...result.validation,
      });
    }

    return NextResponse.json({
      ok: true,
      project: result.project,
      mirrorConflicts: result.mirrorConflicts,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // The transaction rolled back; keep the reporting host visible anyway.
      // Upsert, because a project synced for the first time has no settings
      // row yet and the rolled-back upsert above never committed one.
      const rolledBackOrigin = {
        runtimeSyncSiteHost: getSourceHost(body),
        runtimeSyncApiKeyId: apiKey.id,
      };
      await db.projectSettings
        .upsert({
          where: { projectId: apiKey.project.id },
          create: { projectId: apiKey.project.id, ...rolledBackOrigin },
          update: rolledBackOrigin,
        })
        .catch(() => undefined);

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
