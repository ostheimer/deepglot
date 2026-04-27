import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  PASSWORD_RESET_IDENTIFIER_PREFIX,
  hashPasswordResetToken,
} from "@/lib/password-reset";
import { getCookieLocale } from "@/lib/request-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

export async function POST(request: NextRequest) {
  const locale = await getCookieLocale();
  const schema = z.object({
    token: z.string().min(16, t(locale, "Ungültiger Reset-Link", "Invalid reset link")),
    password: z
      .string()
      .min(8, t(locale, "Passwort muss mindestens 8 Zeichen haben", "Password must be at least 8 characters long")),
  });
  const parsed = schema.safeParse(await request.json().catch(() => null));

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

  const tokenHash = hashPasswordResetToken(parsed.data.token);
  const verificationToken = await db.verificationToken.findFirst({
    where: {
      token: tokenHash,
      identifier: { startsWith: PASSWORD_RESET_IDENTIFIER_PREFIX },
    },
  });

  if (!verificationToken || verificationToken.expires <= new Date()) {
    if (verificationToken) {
      await db.verificationToken.delete({
        where: {
          identifier_token: {
            identifier: verificationToken.identifier,
            token: verificationToken.token,
          },
        },
      });
    }

    return NextResponse.json(
      {
        error: t(
          locale,
          "Dieser Reset-Link ist ungültig oder abgelaufen.",
          "This reset link is invalid or expired."
        ),
      },
      { status: 400 }
    );
  }

  const email = verificationToken.identifier.slice(PASSWORD_RESET_IDENTIFIER_PREFIX.length);
  const hashedPassword = await bcrypt.hash(parsed.data.password, 12);

  await db.$transaction([
    db.user.update({
      where: { email },
      data: { password: hashedPassword },
    }),
    db.verificationToken.delete({
      where: {
        identifier_token: {
          identifier: verificationToken.identifier,
          token: verificationToken.token,
        },
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    message: t(locale, "Passwort erfolgreich geändert.", "Password updated successfully."),
  });
}
