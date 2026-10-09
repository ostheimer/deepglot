import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthenticatedUserId, userCanManageProject } from "@/lib/project-access";
import { createProfessionalOrder } from "@/lib/professional-order-service";
import { lockProfessionalOrderManagerScope } from "@/lib/professional-order-access";
import { ProfessionalOrderError, requireProfessionalOrdersEnabled } from "@/lib/professional-orders";

export const runtime = "nodejs";
const createSchema = z.object({ targetLanguage: z.string().min(2).max(16), translationIds: z.array(z.string().min(1)).min(1).max(100) }).strict();

function failure(error: unknown) {
  if (error instanceof ProfessionalOrderError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "DISABLED" || error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : error.code === "CONFLICT" ? 409 : 400 });
  // Translation content and vendor payloads must never appear in logs.
  console.error("[professional-orders] request failed");
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

async function manager(projektId: string) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await userCanManageProject(userId, projektId))) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) };
  return { userId };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ projektId: string }> }) {
  const { projektId } = await params;
  const actor = await manager(projektId);
  if (actor.error) return actor.error;
  try {
    requireProfessionalOrdersEnabled();
    const orders = await db.$transaction(async (tx) => {
      await lockProfessionalOrderManagerScope(tx, { projectId: projektId, actorId: actor.userId! });
      await tx.professionalTranslationOrder.updateMany({ where: { projectId: projektId, status: "QUOTED", quoteExpiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
      return tx.professionalTranslationOrder.findMany({
        where: { projectId: projektId }, take: 50, orderBy: { createdAt: "desc" },
        select: { id: true, status: true, sourceLanguage: true, targetLanguage: true, wordCount: true, scopeDigest: true, quoteAmountMinor: true, quoteCurrency: true, quoteTurnaroundDays: true, quoteExpiresAt: true, quoteReference: true, createdAt: true, items: { select: { id: true, translationId: true, originalText: true, originalHash: true, sourceUpdatedAt: true, proposedText: true, deliveredAt: true, adoptedAt: true } } },
      });
    });
    return NextResponse.json({ orders }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ projektId: string }> }) {
  const { projektId } = await params;
  const actor = await manager(projektId);
  if (actor.error) return actor.error;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid order scope" }, { status: 400 });
  try {
    const order = await createProfessionalOrder({ projectId: projektId, requesterId: actor.userId!, ...parsed.data });
    return NextResponse.json({ order }, { status: 201 });
  } catch (error) { return failure(error); }
}
