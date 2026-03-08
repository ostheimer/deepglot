import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { getCookieLocale } from "@/lib/request-locale";
import { z } from "zod";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

export async function PATCH(request: Request) {
  const locale = await getCookieLocale();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: t(locale, "Nicht autorisiert", "Not authorized") },
      { status: 401 }
    );
  }

  const schema = z.object({
    currentPassword: z.string().optional(),
    newPassword: z
      .string()
      .min(8, t(locale, "Passwort muss mindestens 8 Zeichen haben", "Password must be at least 8 characters long")),
  });
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues?.[0]?.message ??
          t(locale, "Ungültige Eingabe", "Invalid input"),
      },
      { status: 400 }
    );
  }

  const { currentPassword, newPassword } = parsed.data;

  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user) {
    return NextResponse.json(
      { error: t(locale, "Benutzer nicht gefunden", "User not found") },
      { status: 404 }
    );
  }

  // Verify current password if user has one set
  if (user.password) {
    if (!currentPassword) {
      return NextResponse.json(
        {
          error: t(
            locale,
            "Aktuelles Passwort ist erforderlich",
            "Current password is required"
          ),
        },
        { status: 400 }
      );
    }
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return NextResponse.json(
        {
          error: t(locale, "Aktuelles Passwort ist falsch", "Current password is incorrect"),
        },
        { status: 400 }
      );
    }
  }

  const hashed = await bcrypt.hash(newPassword, 12);
  await db.user.update({
    where: { id: session.user.id },
    data: { password: hashed },
  });

  return NextResponse.json({ success: true });
}
