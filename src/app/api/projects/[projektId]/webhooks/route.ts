import crypto from "crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  getAuthenticatedUserId,
  userCanManageProject,
} from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";
import { PROJECT_WEBHOOK_EVENT_TYPES } from "@/lib/webhooks";
import { WebhookUrlError, parsePublicWebhookUrl } from "@/lib/webhook-url-safety";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

const webhookEndpointSchema = z.object({
  url: z.string().trim().url(),
  eventTypes: z
    .array(z.enum(PROJECT_WEBHOOK_EVENT_TYPES))
    .min(1)
    .transform((eventTypes) => Array.from(new Set(eventTypes))),
  enabled: z.boolean().default(true),
});

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId } = await params;

  if (!userId) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  if (!(await userCanManageProject(userId, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const endpoints = await db.webhookEndpoint.findMany({
    where: { projectId: projektId },
    include: {
      deliveries: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ endpoints });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId } = await params;

  if (!userId) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  if (!(await userCanManageProject(userId, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const parsed = webhookEndpointSchema.safeParse(await request.json());

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

  // Reject private/internal/non-http(s) webhook targets (SSRF guard). The host
  // is re-checked against its resolved IPs at dispatch time.
  try {
    parsePublicWebhookUrl(parsed.data.url);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof WebhookUrlError
            ? error.message
            : t(locale, "Ungültige Webhook-URL", "Invalid webhook URL"),
      },
      { status: 400 }
    );
  }

  const endpoint = await db.webhookEndpoint.create({
    data: {
      projectId: projektId,
      url: parsed.data.url,
      enabled: parsed.data.enabled,
      eventTypes: parsed.data.eventTypes,
      secret: crypto.randomBytes(24).toString("hex"),
    },
    include: {
      deliveries: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  return NextResponse.json({ endpoint }, { status: 201 });
}
