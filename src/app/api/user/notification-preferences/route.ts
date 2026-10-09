import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  OPTIONAL_NOTIFICATION_CATEGORIES,
  OPTIONAL_NOTIFICATION_FREQUENCIES,
  allowedNotificationFrequencies,
} from "@/lib/notification-preferences";
import { SITE_LOCALES } from "@/lib/site-locale";

const patchSchema = z.object({
  organizationId: z.string().min(1),
  category: z.enum(OPTIONAL_NOTIFICATION_CATEGORIES),
  frequency: z.enum(OPTIONAL_NOTIFICATION_FREQUENCIES),
  locale: z.enum(SITE_LOCALES),
}).strict();

async function currentUserId() {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const memberships = await db.organizationMember.findMany({
    where: { userId },
    select: { organizationId: true, role: true, organization: { select: { name: true } } },
  });
  const preferences = await db.notificationPreference.findMany({
    where: { userId, organizationId: { in: memberships.map((member) => member.organizationId) } },
    select: { organizationId: true, category: true, frequency: true, locale: true },
  });
  return NextResponse.json({ memberships: memberships.map((member) => ({
    organizationId: member.organizationId,
    organizationName: member.organization.name,
    role: member.role,
  })), preferences });
}

export async function PATCH(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !allowedNotificationFrequencies(parsed.data.category).includes(parsed.data.frequency)) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }
  const { organizationId, category, frequency, locale } = parsed.data;
  const member = await db.organizationMember.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true },
  });
  if (!member) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (category === "BILLING_SUMMARY" && member.role === "MEMBER" && frequency !== "OFF") {
    return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  }
  const preference = await db.notificationPreference.upsert({
    where: { userId_organizationId_category: { userId, organizationId, category } },
    create: { userId, organizationId, category, frequency, locale },
    update: { frequency, locale },
    select: { organizationId: true, category: true, frequency: true, locale: true },
  });
  return NextResponse.json(preference);
}
