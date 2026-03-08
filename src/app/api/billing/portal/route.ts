import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getBillingPortalReturnUrl } from "@/lib/billing";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  const membership = await db.organizationMember.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { subscription: true } } },
  });

  const customerId = membership?.organization?.subscription?.stripeCustomerId;
  if (!customerId) {
    return NextResponse.json({ error: "Kein Stripe-Kunde gefunden" }, { status: 400 });
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: getBillingPortalReturnUrl(),
  });

  return NextResponse.json({ url: portalSession.url });
}
