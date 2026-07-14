import { NextRequest, NextResponse } from "next/server";

import { validateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { buildRuntimeExclusions } from "@/lib/exclusions";
import { apiProblem } from "@/lib/problem-details";
import {
  PLUGIN_RATE_LIMIT_SCOPE,
  buildRateLimitHeaders,
  consumeRateLimit,
  getRateLimitConfig,
} from "@/lib/rate-limit";

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

    const rules = await db.translationExclusion.findMany({
      where: { projectId: apiKey.projectId },
      orderBy: [{ createdAt: "asc" }, { value: "asc" }],
      select: {
        type: true,
        value: true,
      },
    });
    const exclusions = buildRuntimeExclusions(rules);

    return NextResponse.json({
      exclusions,
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
