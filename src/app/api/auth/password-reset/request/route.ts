import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";
import {
  buildPasswordResetUrl,
  canSendPasswordResetEmail,
  createPasswordResetToken,
  getPasswordResetExpiresAt,
  getPasswordResetIdentifier,
  hashPasswordResetToken,
  normalizePasswordResetEmail,
} from "@/lib/password-reset";
import { getCookieLocale } from "@/lib/request-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

function successMessage(locale: "en" | "de") {
  return t(
    locale,
    "Wenn ein Konto mit dieser E-Mail-Adresse existiert, senden wir dir einen Link zum Zurücksetzen.",
    "If an account exists for this email address, we will send a reset link."
  );
}

export async function POST(request: NextRequest) {
  const locale = await getCookieLocale();
  const schema = z.object({
    email: z
      .string()
      .trim()
      .email(t(locale, "Ungültige E-Mail-Adresse", "Invalid email address")),
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

  const email = normalizePasswordResetEmail(parsed.data.email);
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, password: true },
  });

  if (!user?.password) {
    return NextResponse.json({ ok: true, message: successMessage(locale) });
  }

  const rawToken = createPasswordResetToken();
  const identifier = getPasswordResetIdentifier(email);
  const tokenHash = hashPasswordResetToken(rawToken);
  const resetUrl = buildPasswordResetUrl({ token: rawToken, locale });

  await db.$transaction([
    db.verificationToken.deleteMany({ where: { identifier } }),
    db.verificationToken.create({
      data: {
        identifier,
        token: tokenHash,
        expires: getPasswordResetExpiresAt(),
      },
    }),
  ]);

  if (canSendPasswordResetEmail()) {
    try {
      await sendPasswordResetEmail({ to: user.email, resetUrl, locale });
    } catch (error) {
      console.error("[Password reset] Email delivery failed.", error);
    }
  } else {
    console.warn("[Password reset] Email delivery is not configured.");
  }

  return NextResponse.json({
    ok: true,
    message: successMessage(locale),
    ...(process.env.NODE_ENV === "production" ? {} : { resetUrl }),
  });
}
