import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

async function verifyAccess(userId: string, projektId: string) {
  const project = await db.project.findFirst({
    where: {
      id: projektId,
      organization: { members: { some: { userId } } },
    },
  });
  return project;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const { projektId } = await params;
  const project = await verifyAccess(session.user.id, projektId);
  if (!project) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  return NextResponse.json(project);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const { projektId } = await params;
  const project = await verifyAccess(session.user.id, projektId);
  if (!project) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.project.delete({ where: { id: projektId } });
  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const { projektId } = await params;
  const project = await verifyAccess(session.user.id, projektId);
  if (!project) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();
  const updated = await db.project.update({
    where: { id: projektId },
    data: {
      ...(body.name && { name: body.name }),
      ...(body.domain && { domain: body.domain }),
    },
  });

  return NextResponse.json(updated);
}
