import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: { params: Promise<{ projektId: string; apiKeyId: string }> }
) {
  const locale = await getCookieLocale();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  const { projektId, apiKeyId } = await params;

  const apiKey = await db.apiKey.findFirst({
    where: {
      id: apiKeyId,
      projectId: projektId,
      project: {
        organization: {
          members: {
            some: {
              userId: session.user.id,
            },
          },
        },
      },
    },
  });

  if (!apiKey) {
    return NextResponse.json(
      { error: t(locale, "API-Key nicht gefunden", "API key not found") },
      { status: 404 }
    );
  }

  await db.apiKey.delete({
    where: { id: apiKey.id },
  });

  return NextResponse.json({ success: true });
}
