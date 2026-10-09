import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { ProfessionalOrderError, professionalOrdersEnabled } from "@/lib/professional-orders";
import { applyProfessionalStripeEvent } from "@/lib/professional-order-stripe";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!professionalOrdersEnabled()) return NextResponse.json({ error: "Disabled" }, { status: 404 });
  const key = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.PROFESSIONAL_ORDERS_STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!key || !secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  if (!signature) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  const stripe = new Stripe(key, { apiVersion: "2026-02-25.clover" });
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await request.text(), signature, secret); }
  catch { return NextResponse.json({ error: "Invalid signature" }, { status: 400 }); }
  try {
    await applyProfessionalStripeEvent(event, stripe);
    return NextResponse.json({ received: true });
  } catch (error) {
    if (error instanceof ProfessionalOrderError) {
      // A stale or conflicting event needs merchant reconciliation; do not
      // acknowledge it as paid and never log customer or translation content.
      console.error("[professional-orders] webhook reconciliation required", error.code);
      return NextResponse.json({ error: "Reconciliation required" }, { status: 409 });
    }
    console.error("[professional-orders] webhook failed");
    return NextResponse.json({ error: "Webhook unavailable" }, { status: 503 });
  }
}
