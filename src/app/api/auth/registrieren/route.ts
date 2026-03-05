import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { z } from "zod";

const registerSchema = z.object({
  name: z.string().min(2, "Name muss mindestens 2 Zeichen haben"),
  email: z.string().email("Ungültige E-Mail-Adresse"),
  password: z.string().min(8, "Passwort muss mindestens 8 Zeichen haben"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues?.[0]?.message ?? "Ungültige Eingabe" },
        { status: 400 }
      );
    }

    const { name, email, password } = parsed.data;

    // Check if email is already in use
    const existingUser = await db.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json(
        { error: "Diese E-Mail-Adresse ist bereits registriert" },
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
      { message: "Konto erfolgreich erstellt", userId: result.user.id },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Registrierung] Fehler:", error);
    return NextResponse.json(
      { error: "Registrierung fehlgeschlagen – bitte versuche es später erneut" },
      { status: 500 }
    );
  }
}
