import { NextRequest, NextResponse } from "next/server";

import { validateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { buildRuntimeExclusions } from "@/lib/exclusions";
import {
  MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES,
  inspectMediaRuntimePayload,
  normalizeActiveProjectLanguageCodes,
} from "@/lib/media-runtime-limits";
import { MAX_RUNTIME_MEDIA_REPLACEMENTS } from "@/lib/media-replacements";
import { apiProblem } from "@/lib/problem-details";
import { buildProjectRuntimeSettings } from "@/lib/project-general-settings";
import { decodeWordpressCacheInvalidationKey } from "@/lib/url-operations";
import {
  PLUGIN_RATE_LIMIT_SCOPE,
  buildRateLimitHeaders,
  consumeRateLimit,
  getRateLimitConfig,
} from "@/lib/rate-limit";
import {
  MAX_RUNTIME_URL_SLUGS,
  buildRuntimeUrlSlugs,
} from "@/lib/runtime-url-slugs";

export { MAX_RUNTIME_URL_SLUGS } from "@/lib/runtime-url-slugs";
export { MAX_RUNTIME_MEDIA_REPLACEMENTS } from "@/lib/media-replacements";
export { MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES } from "@/lib/media-runtime-limits";

function getRawApiKey(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const queryApiKey = searchParams.get("api_key");
  const authorization = request.headers.get("authorization");
  const bearerKey = authorization?.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : null;

  return queryApiKey ?? bearerKey;
}

export async function GET(request: NextRequest) {
  try {
    const rawApiKey = getRawApiKey(request);

    if (!rawApiKey) {
      return apiProblem({
        status: 401,
        title: "Authentication required",
        detail: "Missing API key.",
        code: "missing_api_key",
        instance: "/api/plugin/runtime-config",
      });
    }

    const apiKey = await validateApiKey(rawApiKey);
    if (!apiKey) {
      return apiProblem({
        status: 401,
        title: "Authentication failed",
        detail: "Invalid or expired API key.",
        code: "invalid_api_key",
        instance: "/api/plugin/runtime-config",
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
        instance: "/api/plugin/runtime-config",
        extensions: { retry_after: rateLimit.retryAfterSeconds },
        headers: buildRateLimitHeaders(rateLimit),
      });
    }

    const activeTargetLanguages = normalizeActiveProjectLanguageCodes(
      apiKey.project.languages
        .filter((language) => language.isActive)
        .map((language) => language.langCode)
    );

    const [rules, urlSlugs, mediaReplacementRows] = await Promise.all([
      db.translationExclusion.findMany({
        where: { projectId: apiKey.projectId },
        orderBy: [{ createdAt: "asc" }, { value: "asc" }],
        select: {
          type: true,
          value: true,
        },
      }),
      db.urlSlug.findMany({
        where: {
          projectId: apiKey.projectId,
          langTo: { in: activeTargetLanguages },
        },
        orderBy: [{ langTo: "asc" }, { originalSlug: "asc" }],
        select: {
          originalSlug: true,
          translatedSlug: true,
          langTo: true,
        },
        // Fetch one sentinel row so collision analysis is never performed on
        // a silently truncated set of source slugs.
        take: MAX_RUNTIME_URL_SLUGS + 1,
      }),
      db.projectMediaReplacement.findMany({
        where: {
          projectId: apiKey.projectId,
          langTo: { in: activeTargetLanguages },
        },
        orderBy: [{ langTo: "asc" }, { originalUrl: "asc" }],
        select: {
          originalUrl: true,
          localizedUrl: true,
          langTo: true,
        },
        // Reject an oversized mapping set rather than silently localizing an
        // arbitrary prefix of the project's media mappings.
        take: MAX_RUNTIME_MEDIA_REPLACEMENTS + 1,
      }),
    ]);

    if (urlSlugs.length > MAX_RUNTIME_URL_SLUGS) {
      return apiProblem({
        status: 413,
        title: "Runtime configuration too large",
        detail: `The project has more than ${MAX_RUNTIME_URL_SLUGS} URL slug records. Reduce the mapping set before retrying so translated routes remain collision-safe.`,
        code: "runtime_url_slugs_limit_exceeded",
        instance: "/api/plugin/runtime-config",
        extensions: { limit: MAX_RUNTIME_URL_SLUGS },
      });
    }

    if (mediaReplacementRows.length > MAX_RUNTIME_MEDIA_REPLACEMENTS) {
      return apiProblem({
        status: 413,
        title: "Runtime configuration too large",
        detail: `The project has more than ${MAX_RUNTIME_MEDIA_REPLACEMENTS} media replacements. Reduce the mapping set before retrying.`,
        code: "runtime_media_replacements_limit_exceeded",
        instance: "/api/plugin/runtime-config",
        extensions: { limit: MAX_RUNTIME_MEDIA_REPLACEMENTS },
      });
    }

    const { mediaReplacements, byteLength: mediaReplacementBytes } =
      inspectMediaRuntimePayload(mediaReplacementRows);

    if (mediaReplacementBytes > MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES) {
      return apiProblem({
        status: 413,
        title: "Runtime configuration too large",
        detail: "The project's media replacement configuration exceeds its safe size limit.",
        code: "runtime_media_replacements_limit_exceeded",
        instance: "/api/plugin/runtime-config",
        extensions: { limit: MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES },
      });
    }

    const exclusions = buildRuntimeExclusions(rules);
    const afterRaw = new URL(request.url).searchParams.get("cache_after") ?? "0";
    if (!/^\d{1,20}$/.test(afterRaw)) {
      return apiProblem({ status: 400, title: "Invalid cache cursor", detail: "cache_after must be a nonnegative integer.", code: "invalid_cache_cursor", instance: "/api/plugin/runtime-config" });
    }
    const cacheAfter = BigInt(afterRaw);
    if (cacheAfter > BigInt("9223372036854775807")) {
      return apiProblem({ status: 400, title: "Invalid cache cursor", detail: "cache_after exceeds the supported range.", code: "invalid_cache_cursor", instance: "/api/plugin/runtime-config" });
    }
    const cacheInvalidationRows = await db.urlCacheInvalidation.findMany({
      where: { projectId: apiKey.projectId, id: { gt: cacheAfter } },
      orderBy: { id: "asc" }, take: 251,
      select: { id: true, urlPath: true, cacheKey: true },
    });

    return NextResponse.json({
      cacheInvalidations: {
        entries: cacheInvalidationRows.slice(0, 250).map((item) => ({
          id: item.id.toString(), urlPath: item.urlPath,
          ...decodeWordpressCacheInvalidationKey(item.cacheKey),
        })),
        hasMore: cacheInvalidationRows.length > 250,
      },
      exclusions,
      mediaReplacements,
      pageViewsEnabled:
        apiKey.project.settings?.pageViewsEnabled === true &&
        apiKey.project.settings.pageViewsConsentGrantedAt instanceof Date,
      project: buildProjectRuntimeSettings(apiKey.project),
      switcher: apiKey.project.settings?.switcherOwner === "saas" && apiKey.project.settings.switcherConfig
        ? {
            contractVersion: 1,
            owner: "saas",
            revision: apiKey.project.settings.switcherRevision,
            config: apiKey.project.settings.switcherConfig,
            baseConfig: apiKey.project.settings.switcherBaseConfig,
            baseRevision: apiKey.project.settings.switcherBaseRevision,
          }
        : { contractVersion: 1, owner: "wordpress", revision: apiKey.project.settings?.switcherRevision ?? 0 },
      urlSlugs: buildRuntimeUrlSlugs(urlSlugs),
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[GET /api/plugin/runtime-config] Failed:", error);
    return apiProblem({
      status: 500,
      title: "Internal server error",
      detail: "Could not load the plugin runtime configuration.",
      code: "internal_error",
      instance: "/api/plugin/runtime-config",
    });
  }
}
