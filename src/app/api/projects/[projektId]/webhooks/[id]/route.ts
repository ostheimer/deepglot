import crypto from "crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  getAuthenticatedUserId,
  userHasProjectAccess,
} from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";
import { PROJECT_WEBHOOK_EVENT_TYPES } from "@/lib/webhooks";

const webhookEndpointSchema = z.object({
  url: z.string().trim().url().optional(),
  eventTypes: z
    .array(z.enum(PROJECT_WEBHOOK_EVENT_TYPES))
    .min(1)
    .transform((eventTypes) => Array.from(new Set(eventTypes)))
    .optional(),
  enabled: z.boolean().optional(),
  rotateSecret: z.boolean().optional(),
});

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

async function loadEndpoint(projektId: string, id: string) {
  return db.webhookEndpoint.findFirst({
    where: {
      id,
      projectId: projektId,
    },
    include: {
      deliveries: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string; id: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId, id } = await params;

  if (!userId) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  if (!(await userHasProjectAccess(userId, projektId))) {
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

  const existing = await loadEndpoint(projektId, id);

  if (!existing) {
    return NextResponse.json(
      { error: t(locale, "Webhook nicht gefunden", "Webhook not found") },
      { status: 404 }
    );
  }

  const endpoint = await db.webhookEndpoint.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.url ? { url: parsed.data.url } : {}),
      ...(parsed.data.eventTypes ? { eventTypes: parsed.data.eventTypes } : {}),
      ...(typeof parsed.data.enabled === "boolean"
        ? { enabled: parsed.data.enabled }
        : {}),
      ...(parsed.data.rotateSecret
        ? { secret: crypto.randomBytes(24).toString("hex") }
        : {}),
    },
    include: {
      deliveries: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  return NextResponse.json({ endpoint });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projektId: string; id: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId, id } = await params;

  if (!userId) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  if (!(await userHasProjectAccess(userId, projektId))) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const existing = await loadEndpoint(projektId, id);

  if (!existing) {
    return NextResponse.json(
      { error: t(locale, "Webhook nicht gefunden", "Webhook not found") },
      { status: 404 }
    );
  }

  await db.webhookEndpoint.delete({
    where: { id: existing.id },
  });

  return NextResponse.json({ ok: true });
}
