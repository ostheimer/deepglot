import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { Plan, SubscriptionStatus } from "@prisma/client";
import Stripe from "stripe";

const STRIPE_PLAN_MAP: Record<string, Plan> = {
  [process.env.STRIPE_PRICE_STARTER_MONTHLY ?? ""]: "STARTER",
  [process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY ?? ""]: "PROFESSIONAL",
  [process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY ?? ""]: "ENTERPRISE",
};

const WORDS_LIMIT_MAP: Record<Plan, number> = {
  FREE: 10_000,
  STARTER: 200_000,
  PROFESSIONAL: 1_000_000,
  ENTERPRISE: 10_000_000,
};

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Fehlende Stripe-Signatur" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return NextResponse.json({ error: "Ungültige Webhook-Signatur" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaid(invoice);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentFailed(invoice);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Stripe Webhook] Verarbeitungsfehler:", error);
    return NextResponse.json({ error: "Webhook-Verarbeitungsfehler" }, { status: 500 });
  }
}

// Get the period end from the first subscription item (Stripe API 2026+)
function getPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const firstItem = subscription.items?.data[0];
  if (firstItem?.current_period_end) {
    return new Date(firstItem.current_period_end * 1000);
  }
  return null;
}

// Get subscription ID from invoice (Stripe API 2026+)
function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  // In newer Stripe API, subscription details may be nested under parent
  const parent = invoice.parent as
    | (Stripe.Invoice.Parent & { subscription_details?: { subscription?: string | Stripe.Subscription } })
    | null;

  const sub = parent?.subscription_details?.subscription;
  if (!sub) return null;
  return typeof sub === "string" ? sub : sub.id;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const organizationId = session.metadata?.organizationId;
  if (!organizationId) return;

  const stripeSubscription = await stripe.subscriptions.retrieve(
    session.subscription as string
  );

  const priceId = stripeSubscription.items.data[0]?.price.id;
  const plan = STRIPE_PLAN_MAP[priceId] ?? "STARTER";

  await db.subscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: stripeSubscription.id,
      stripePriceId: priceId,
      status: "ACTIVE",
      plan,
      wordsLimit: WORDS_LIMIT_MAP[plan],
      stripeCurrentPeriodEnd: getPeriodEnd(stripeSubscription),
    },
    update: {
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: stripeSubscription.id,
      stripePriceId: priceId,
      status: "ACTIVE",
      plan,
      wordsLimit: WORDS_LIMIT_MAP[plan],
      stripeCurrentPeriodEnd: getPeriodEnd(stripeSubscription),
    },
  });

  await db.organization.update({
    where: { id: organizationId },
    data: { plan },
  });
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!stripeSubscriptionId) return;

  const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

  await db.subscription.update({
    where: { stripeSubscriptionId },
    data: {
      status: "ACTIVE",
      stripeCurrentPeriodEnd: getPeriodEnd(stripeSubscription),
    },
  });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!stripeSubscriptionId) return;

  await db.subscription.update({
    where: { stripeSubscriptionId },
    data: { status: "PAST_DUE" },
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const dbSubscription = await db.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id },
  });
  if (!dbSubscription) return;

  await db.subscription.update({
    where: { stripeSubscriptionId: subscription.id },
    data: { status: "CANCELED", plan: "FREE" },
  });

  await db.organization.update({
    where: { id: dbSubscription.organizationId },
    data: { plan: "FREE" },
  });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const priceId = subscription.items.data[0]?.price.id;
  const plan = STRIPE_PLAN_MAP[priceId] ?? "FREE";
  const status = mapStripeStatus(subscription.status);

  await db.subscription.update({
    where: { stripeSubscriptionId: subscription.id },
    data: {
      stripePriceId: priceId,
      plan,
      status,
      wordsLimit: WORDS_LIMIT_MAP[plan],
      stripeCurrentPeriodEnd: getPeriodEnd(subscription),
    },
  });
}

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  const map: Record<string, SubscriptionStatus> = {
    active: "ACTIVE",
    trialing: "TRIALING",
    past_due: "PAST_DUE",
    canceled: "CANCELED",
    unpaid: "PAST_DUE",
    incomplete: "INACTIVE",
    incomplete_expired: "INACTIVE",
    paused: "INACTIVE",
  };
  return map[status] ?? "INACTIVE";
}
