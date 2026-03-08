import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";
import { z } from "zod";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

export async function POST(req: NextRequest) {
  try {
    const locale = await getCookieLocale();
    const registerSchema = z.object({
      name: z.string().min(2, t(locale, "Name muss mindestens 2 Zeichen haben", "Name must be at least 2 characters long")),
      email: z.string().email(t(locale, "Ungültige E-Mail-Adresse", "Invalid email address")),
      password: z.string().min(8, t(locale, "Passwort muss mindestens 8 Zeichen haben", "Password must be at least 8 characters long")),
    });
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

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

    const { name, email, password } = parsed.data;

    // Check if email is already in use
    const existingUser = await db.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json(
        {
          error: t(
            locale,
            "Diese E-Mail-Adresse ist bereits registriert",
            "This email address is already registered"
          ),
        },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user and default organization in a transaction
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
        },
      });

      // Generate a slug from the user's name
      const slug = `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;

      const org = await tx.organization.create({
        data: {
          name: `${name}s Organisation`,
          slug,
          plan: "FREE",
        },
      });

      await tx.organizationMember.create({
        data: {
          userId: user.id,
          organizationId: org.id,
          role: "OWNER",
        },
      });

      // Create free tier subscription
      await tx.subscription.create({
        data: {
          organizationId: org.id,
          stripeCustomerId: `free_${user.id}`,
          status: "ACTIVE",
          plan: "FREE",
          wordsLimit: 10_000,
        },
      });

      return { user, org };
    });

    return NextResponse.json(
      {
        message: t(locale, "Konto erfolgreich erstellt", "Account created successfully"),
        userId: result.user.id,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Registrierung] Fehler:", error);
    const locale = await getCookieLocale();
    return NextResponse.json(
      {
        error: t(
          locale,
          "Registrierung fehlgeschlagen – bitte versuche es später erneut",
          "Registration failed. Please try again later."
        ),
      },
      { status: 500 }
    );
  }
}
