import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userCanManageProject } from "@/lib/project-access";

// Reading basic project info stays available to any organization member.
// Mutating actions (PATCH/DELETE) are management-only — see the
// `userCanManageProject` checks below — so the API mirrors the settings pages,
// which all gate on `requireProjectManagement`.
async function verifyOrgMembership(userId: string, projektId: string) {
  return db.project.findFirst({
    where: {
      id: projektId,
      organization: { members: { some: { userId } } },
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const { projektId } = await params;
  const project = await verifyOrgMembership(session.user.id, projektId);
  if (!project)
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  return NextResponse.json(project);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const { projektId } = await params;
  // Deleting a project is destructive and irreversible (the project and its
  // translations are removed). Restrict to project managers, not any member.
  if (!(await userCanManageProject(session.user.id, projektId))) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  await db.project.delete({ where: { id: projektId } });
  return NextResponse.json({ success: true });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  domain: z.string().trim().min(1).max(255).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const { projektId } = await params;
  if (!(await userCanManageProject(session.user.id, projektId))) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  const updated = await db.project.update({
    where: { id: projektId },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.domain !== undefined && { domain: parsed.data.domain }),
    },
  });

  return NextResponse.json(updated);
}
