import { NextRequest, NextResponse } from "next/server";

import { validateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import {
  PAGE_VIEW_MAX_REQUEST_BODY_BYTES,
  PAGE_VIEW_RATE_LIMIT_SCOPE,
  getPageViewRateLimitPerMinute,
  isPageViewBot,
  pageViewEventSchema,
} from "@/lib/page-views";
import { apiProblem, validationProblem } from "@/lib/problem-details";
import {
  buildRateLimitHeaders,
  consumeRateLimit,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

const PAGE_VIEW_INSTANCE = "/api/plugin/page-views";

function requestBodyTooLarge() {
  return apiProblem({
    status: 413,
    title: "Request body too large",
    detail: "Page-view events must contain only a bounded minimal payload.",
    code: "request_body_too_large",
    instance: PAGE_VIEW_INSTANCE,
  });
}

function bearerApiKey(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const apiKey = match?.[1]?.trim();

  return apiKey || null;
}

function isUniqueConstraintConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  // Prisma 7 driver adapters can omit meta.target entirely and expose only
  // meta.modelName. Verify the actual conflicting event with a lookup below.
  return (error as { code?: unknown }).code === "P2002";
}

async function collectPageView(request: NextRequest) {
  const rawApiKey = bearerApiKey(request);

  if (!rawApiKey) {
    return apiProblem({
      status: 401,
      title: "Authentication required",
      detail: "Missing API key.",
      code: "missing_api_key",
      instance: PAGE_VIEW_INSTANCE,
    });
  }

  const apiKey = await validateApiKey(rawApiKey);

  if (!apiKey) {
    return apiProblem({
      status: 401,
      title: "Authentication failed",
      detail: "Invalid or expired API key.",
      code: "invalid_api_key",
      instance: PAGE_VIEW_INSTANCE,
    });
  }

  if (
    apiKey.project.settings?.pageViewsEnabled !== true ||
    !(apiKey.project.settings.pageViewsConsentGrantedAt instanceof Date)
  ) {
    return NextResponse.json({ tracked: false, reason: "disabled" });
  }

  if (isPageViewBot(request.headers.get("user-agent"))) {
    return NextResponse.json({ tracked: false, reason: "bot" });
  }

  const contentLength = request.headers.get("content-length");

  if (
    contentLength &&
    Number(contentLength) > PAGE_VIEW_MAX_REQUEST_BODY_BYTES
  ) {
    return requestBodyTooLarge();
  }

  let requestBody: unknown;

  try {
    const rawBody = await request.text();

    if (Buffer.byteLength(rawBody, "utf8") > PAGE_VIEW_MAX_REQUEST_BODY_BYTES) {
      return requestBodyTooLarge();
    }

    requestBody = JSON.parse(rawBody);
  } catch {
    return validationProblem({
      detail: "Request body must be valid JSON.",
      instance: PAGE_VIEW_INSTANCE,
      errors: { body: ["Invalid JSON"] },
    });
  }

  const event = pageViewEventSchema.safeParse(requestBody);

  if (!event.success) {
    const errors = event.error.issues.reduce<Record<string, string[]>>(
      (fieldErrors, issue) => {
        const field = issue.path.join(".") || "body";
        fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message];
        return fieldErrors;
      },
      {},
    );

    return validationProblem({
      detail: event.error.issues[0]?.message ?? "Invalid page-view event.",
      instance: PAGE_VIEW_INSTANCE,
      errors,
    });
  }

  const activeTargetLanguage = apiKey.project.languages.some(
    (language) =>
      language.isActive &&
      language.langCode.toLowerCase() === event.data.langTo,
  );

  if (!activeTargetLanguage) {
    return validationProblem({
      detail: "Target language is not active for this project.",
      instance: PAGE_VIEW_INSTANCE,
      errors: { langTo: ["Target language is not active for this project."] },
    });
  }

  const rateLimit = await consumeRateLimit({
    scope: PAGE_VIEW_RATE_LIMIT_SCOPE,
    subject: apiKey.projectId,
    limit: getPageViewRateLimitPerMinute(),
  });

  if (!rateLimit.allowed) {
    return apiProblem({
      status: 429,
      title: "Rate limit exceeded",
      detail: `Maximum ${rateLimit.limit} page-view events per project per minute.`,
      code: "rate_limit_exceeded",
      instance: PAGE_VIEW_INSTANCE,
      extensions: { retry_after: rateLimit.retryAfterSeconds },
      headers: buildRateLimitHeaders(rateLimit),
    });
  }

  try {
    await db.pageView.create({
      data: {
        eventId: event.data.eventId,
        urlPath: event.data.urlPath,
        langTo: event.data.langTo,
        projectId: apiKey.projectId,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintConflict(error)) {
      throw error;
    }

    const existingEvent = await db.pageView.findUnique({
      where: { eventId: event.data.eventId },
      select: { projectId: true },
    });

    if (!existingEvent) {
      throw error;
    }

    if (existingEvent.projectId === apiKey.projectId) {
      return NextResponse.json({ tracked: false, reason: "duplicate" });
    }

    return apiProblem({
      status: 409,
      title: "Event ID conflict",
      detail: "The event ID cannot be accepted for this project.",
      code: "event_id_conflict",
      instance: PAGE_VIEW_INSTANCE,
    });
  }

  return NextResponse.json({ tracked: true }, { status: 201 });
}

export async function POST(request: NextRequest) {
  try {
    return await collectPageView(request);
  } catch (error) {
    console.error("[POST /api/plugin/page-views] Collection failed:", error);

    return apiProblem({
      status: 500,
      title: "Internal server error",
      detail: "Could not collect the page-view event.",
      code: "internal_error",
      instance: PAGE_VIEW_INSTANCE,
    });
  }
}
