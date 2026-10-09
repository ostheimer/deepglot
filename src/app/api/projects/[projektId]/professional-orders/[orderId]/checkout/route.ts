import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getAppBaseUrl } from "@/lib/billing";
import { getAuthenticatedUserId, userCanManageProject } from "@/lib/project-access";
import { ProfessionalOrderError, professionalOrdersEnabled } from "@/lib/professional-orders";
import { beginProfessionalCheckout } from "@/lib/professional-order-stripe";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ projektId: string; orderId: string }> }) {
  const { projektId, orderId } = await params;
  const actorId = await getAuthenticatedUserId();
  if (!actorId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await userCanManageProject(actorId, projektId))) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!professionalOrdersEnabled()) return NextResponse.json({ error: "Checkout disabled" }, { status: 404 });
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "Checkout is not configured" }, { status: 503 });
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-02-25.clover" });
    const result = await beginProfessionalCheckout({ orderId, projectId: projektId, actorId, returnBaseUrl: getAppBaseUrl().replace(/\/$/, "") }, stripe);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProfessionalOrderError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "DISABLED" || error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : error.code === "CONFLICT" ? 409 : 400 });
    console.error("[professional-orders] checkout failed");
    return NextResponse.json({ error: "Checkout unavailable" }, { status: 503 });
  }
}
