import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import {
  blocksNewCheckoutForExistingSubscription,
  getCheckoutCancelUrl,
  getCheckoutSuccessUrl,
  isRealStripeCustomerId,
} from "@/lib/billing";
import { getCookieLocale } from "@/lib/request-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";
import {
  BILLING_PLAN_KEYS,
  getStripePriceIdFromEnv,
} from "@/lib/billing-plans";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

const checkoutSchema = z.object({
  // FREE and ENTERPRISE have no Stripe price and are rejected explicitly.
  plan: z.enum(["STARTER", "BUSINESS", "PRO", "ADVANCED", "EXTENDED"]),
  interval: z.enum(["monthly", "yearly"]),
});

export async function POST(request: Request) {
  const locale = await getCookieLocale();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: t(locale, "Nicht autorisiert", "Not authorized") },
      { status: 401 }
    );
  }

  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: t(locale, "Ungültiger Plan", "Invalid plan") },
      { status: 400 }
    );
  }

  const { plan, interval } = parsed.data;
  // Defence in depth: the zod enum already excludes FREE/ENTERPRISE, but a
  // misconfigured env (missing Live price id) must not silently fall through.
  if (!BILLING_PLAN_KEYS.includes(plan)) {
    return NextResponse.json(
      { error: t(locale, "Ungültiger Plan", "Invalid plan") },
      { status: 400 }
    );
  }

  const priceId = getStripePriceIdFromEnv(plan, interval);
  if (!priceId) {
    return NextResponse.json(
      {
        error: t(
          locale,
          "Für diesen Plan ist keine Abrechnung konfiguriert",
          "Billing is not configured for this plan"
        ),
      },
      { status: 400 }
    );
  }

  const membership = await db.organizationMember.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { subscription: true } } },
  });

  const organization = membership?.organization;
  if (!organization) {
    return NextResponse.json(
      {
        error: t(
          locale,
          "Keine Organisation gefunden",
          "No organization found"
        ),
      },
      { status: 409 }
    );
  }

  // Defence in depth: a plan change for an org with a live subscription must go
  // through the billing portal (Stripe swaps the subscription with proration).
  // The plan-switcher UI already routes those clicks to the portal; this stops a
  // direct Checkout call from creating a *second* paid subscription.
  const existingSubscription = organization.subscription;
  if (blocksNewCheckoutForExistingSubscription(existingSubscription)) {
    return NextResponse.json(
      {
        error: t(
          locale,
          "Für Planwechsel bitte das Abrechnungsportal verwenden",
          "Use the billing portal to change your plan"
        ),
      },
      { status: 409 }
    );
  }

  // Reuse a real Stripe customer when one exists. Free-tier rows carry a
  // synthetic `free_<userId>` placeholder (written at registration), and
  // hand-managed tiers (e.g. ENTERPRISE) carry `manual_<orgId>`. Neither is a
  // real Stripe customer; use the centralised allowlist of `cus_…` ids so a
  // new placeholder scheme can't quietly turn into a Stripe API error.
  const existingCustomerId = organization.subscription?.stripeCustomerId;
  const hasRealCustomer = isRealStripeCustomerId(existingCustomerId);

  let customerId = existingCustomerId;
  if (!hasRealCustomer) {
    const customer = await stripe.customers.create({
      email: session.user.email ?? undefined,
      name: session.user.name ?? undefined,
      metadata: {
        organizationId: organization.id,
        userId: session.user.id,
      },
    });
    customerId = customer.id;

    // Persist immediately so the billing portal and webhook can resolve the
    // customer even if the user abandons Checkout before completing payment.
    await db.subscription.update({
      where: { organizationId: organization.id },
      data: { stripeCustomerId: customer.id },
    });
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: session.user.id,
    allow_promotion_codes: true,
    locale: locale === "de" ? "de" : "en",
    metadata: {
      organizationId: organization.id,
      userId: session.user.id,
      plan,
      interval,
    },
    subscription_data: {
      metadata: {
        organizationId: organization.id,
        userId: session.user.id,
      },
    },
    success_url: getCheckoutSuccessUrl(),
    cancel_url: getCheckoutCancelUrl(),
  });

  if (!checkoutSession.url) {
    return NextResponse.json(
      {
        error: t(
          locale,
          "Checkout konnte nicht gestartet werden",
          "Could not start checkout"
        ),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ url: checkoutSession.url });
}
