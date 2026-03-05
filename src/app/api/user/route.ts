import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { z } from "zod";

const updateSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
});

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues?.[0]?.message ?? "Ungültige Eingabe" },
      { status: 400 }
    );
  }

  const { email, firstName, lastName } = parsed.data;
  const name = [firstName, lastName].filter(Boolean).join(" ") || undefined;

  await db.user.update({
    where: { id: session.user.id },
    data: {
      ...(email && { email }),
      ...(name !== undefined && { name }),
    },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  // Delete user (cascade will handle related records via Prisma schema)
  await db.user.delete({ where: { id: session.user.id } });

  return NextResponse.json({ success: true });
}
