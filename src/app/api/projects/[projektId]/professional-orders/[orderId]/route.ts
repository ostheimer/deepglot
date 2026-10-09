import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId, userCanManageProject } from "@/lib/project-access";
import { acceptProfessionalQuote, adoptProfessionalDelivery, cancelProfessionalOrder, issueVendorGrant } from "@/lib/professional-order-service";
import { ProfessionalOrderError } from "@/lib/professional-orders";

export const runtime = "nodejs";
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("vendor_grant") }).strict(),
  z.object({ action: z.literal("accept_quote"), expectedScopeDigest: z.string().regex(/^[a-f0-9]{64}$/), expectedQuoteReference: z.string().min(1) }).strict(),
  z.object({ action: z.literal("cancel") }).strict(),
  z.object({ action: z.literal("adopt_delivery"), itemId: z.string().min(1), expectedUpdatedAt: z.string().datetime({ offset: true }) }).strict(),
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ projektId: string; orderId: string }> }) {
  const { projektId, orderId } = await params;
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await userCanManageProject(userId, projektId))) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid order action" }, { status: 400 });
  try {
    const action = parsed.data;
    const result = action.action === "vendor_grant"
      ? await issueVendorGrant({ orderId, projectId: projektId, actorId: userId })
      : action.action === "accept_quote"
        ? await acceptProfessionalQuote({ orderId, projectId: projektId, actorId: userId, expectedScopeDigest: action.expectedScopeDigest, expectedQuoteReference: action.expectedQuoteReference })
        : action.action === "cancel"
          ? await cancelProfessionalOrder({ orderId, projectId: projektId, actorId: userId })
          : await adoptProfessionalDelivery({ orderId, projectId: projektId, actorId: userId, itemId: action.itemId, expectedUpdatedAt: new Date(action.expectedUpdatedAt) });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProfessionalOrderError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "DISABLED" || error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : error.code === "CONFLICT" ? 409 : 400 });
    console.error("[professional-orders] action failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
