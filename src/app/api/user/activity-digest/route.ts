import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { SITE_LOCALES } from "@/lib/site-locale";

const patchSchema = z.object({
  organizationId: z.string().min(1),
  enabled: z.boolean(),
  locale: z.enum(SITE_LOCALES),
});

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  const membership = await db.organizationMember.findUnique({
    where: {
      userId_organizationId: {
        userId: session.user.id,
        organizationId: parsed.data.organizationId,
      },
    },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const updated = await db.organizationMember.update({
    where: { id: membership.id },
    data: {
      activityDigestEnabled: parsed.data.enabled,
      activityDigestLocale: parsed.data.locale,
    },
    select: {
      organizationId: true,
      activityDigestEnabled: true,
      activityDigestLocale: true,
    },
  });

  return NextResponse.json({
    organizationId: updated.organizationId,
    enabled: updated.activityDigestEnabled,
    locale: updated.activityDigestLocale,
  });
}
