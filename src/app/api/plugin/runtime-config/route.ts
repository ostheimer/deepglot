import { NextRequest, NextResponse } from "next/server";

import { validateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { buildRuntimeExclusions } from "@/lib/exclusions";
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
  const rawApiKey = getRawApiKey(request);

  if (!rawApiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 401 });
  }

  const apiKey = await validateApiKey(rawApiKey);
  if (!apiKey) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
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
}
