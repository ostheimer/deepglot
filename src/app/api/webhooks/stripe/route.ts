import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import {
  BILLING_PLANS,
  BILLING_PLAN_KEYS,
  tryResolvePlanKeyByStripePriceId,
} from "@/lib/billing-plans";
import { checkoutCompletionIsDuplicate } from "@/lib/billing";
import { Plan, SubscriptionStatus } from "@prisma/client";
import Stripe from "stripe";

/**
 * Stripe-priceId → Plan map. Kept for callers that prefer a direct lookup;
 * `findPlanKeyByStripePriceId` is the canonical resolver because it iterates
 * both monthly and yearly env keys.
 */
const STRIPE_PLAN_MAP: Record<string, Plan> = BILLING_PLAN_KEYS.reduce(
  (accumulator, key) => {
    const plan = BILLING_PLANS[key];
    for (const interval of ["monthly", "yearly"] as const) {
      const envKey = plan.stripePriceIdEnvKeys[interval];
      if (!envKey) continue;
      const value = process.env[envKey];
      if (value && value.trim() !== "") {
        accumulator[value] = key;
      }
    }
    return accumulator;
  },
  {} as Record<string, Plan>
);

const WORDS_LIMIT_MAP: Record<Plan, number> = {
  ...(BILLING_PLAN_KEYS.reduce(
    (accumulator, key) => {
      accumulator[key] = BILLING_PLANS[key].wordsLimit;
      return accumulator;
    },
    {} as Record<Plan, number>
  )),
  // Legacy enum value retained for historical rows; treat it as the new PRO
  // tier so older subscriptions keep their accustomed quota.
  PROFESSIONAL: BILLING_PLANS.PRO.wordsLimit,
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

/**
 * Fallback organization resolver for checkout sessions whose metadata is
 * missing the organizationId (e.g. Payment Links created outside the app).
 * Prefers `client_reference_id` (the app sets it to the user id), then the
 * Stripe customer already stored on a subscription row.
 */
async function resolveOrganizationId(
  session: Stripe.Checkout.Session
): Promise<string | null> {
  const userId = session.client_reference_id ?? session.metadata?.userId;
  if (userId) {
    const membership = await db.organizationMember.findFirst({
      where: { userId },
      select: { organizationId: true },
    });
    if (membership) return membership.organizationId;
  }

  if (typeof session.customer === "string") {
    const sub = await db.subscription.findUnique({
      where: { stripeCustomerId: session.customer },
      select: { organizationId: true },
    });
    if (sub) return sub.organizationId;
  }

  return null;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const organizationId =
    session.metadata?.organizationId ??
    (await resolveOrganizationId(session));
  if (!organizationId) return;

  const stripeSubscription = await stripe.subscriptions.retrieve(
    session.subscription as string
  );

  const priceId = stripeSubscription.items.data[0]?.price.id;
  const metadataPlan = session.metadata?.plan;
  let plan: Plan | undefined = tryResolvePlanKeyByStripePriceId(priceId) ?? undefined;
  if (!plan && metadataPlan && (BILLING_PLAN_KEYS as readonly string[]).includes(metadataPlan)) {
    plan = metadataPlan as Plan;
  }
  if (!plan) {
    const existing = await db.subscription.findUnique({
      where: { organizationId },
      select: { plan: true },
    });
    plan = existing?.plan ?? "STARTER";
    console.warn(
      "[Stripe Webhook] checkout.session.completed: unknown price id, using fallback plan",
      priceId,
      "metadata.plan",
      metadataPlan,
      "fallback",
      plan
    );
  }
  const resolvedPlan: Plan = plan;

  // #138 safety net: the pre-checkout open-session reuse prevents duplicate
  // sessions in the common case, but a sub-second concurrent race can still let
  // two Checkouts complete. If the org already tracks a different live
  // subscription, this completed Checkout is a duplicate — per the "prevent +
  // alert" decision we do NOT auto-cancel/refund. Keep the first subscription
  // (don't overwrite it) and flag the extra one loudly for manual handling; it
  // is otherwise orphaned (billing in Stripe but not in the DB).
  const existingForDuplicateCheck = await db.subscription.findUnique({
    where: { organizationId },
    select: { stripeSubscriptionId: true, status: true },
  });
  if (
    checkoutCompletionIsDuplicate(existingForDuplicateCheck, stripeSubscription.id)
  ) {
    console.error(
      "[Stripe Webhook] DUPLICATE SUBSCRIPTION for org",
      organizationId,
      "— keeping",
      existingForDuplicateCheck?.stripeSubscriptionId,
      "; new subscription is orphaned, cancel/refund it manually:",
      stripeSubscription.id
    );
    return;
  }

  await db.subscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: stripeSubscription.id,
      stripePriceId: priceId,
      status: "ACTIVE",
      plan: resolvedPlan,
      wordsLimit: WORDS_LIMIT_MAP[resolvedPlan],
      stripeCurrentPeriodEnd: getPeriodEnd(stripeSubscription),
    },
    update: {
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: stripeSubscription.id,
      stripePriceId: priceId,
      status: "ACTIVE",
      plan: resolvedPlan,
      wordsLimit: WORDS_LIMIT_MAP[resolvedPlan],
      stripeCurrentPeriodEnd: getPeriodEnd(stripeSubscription),
    },
  });

  await db.organization.update({
    where: { id: organizationId },
    data: { plan: resolvedPlan },
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
  const resolvedPlanKey = tryResolvePlanKeyByStripePriceId(priceId);
  const status = mapStripeStatus(subscription.status);

  const updateData: {
    stripePriceId?: string;
    status: SubscriptionStatus;
    stripeCurrentPeriodEnd: Date | null;
    plan?: Plan;
    wordsLimit?: number;
  } = {
    stripePriceId: priceId,
    status,
    stripeCurrentPeriodEnd: getPeriodEnd(subscription),
  };

  if (resolvedPlanKey) {
    updateData.plan = resolvedPlanKey;
    updateData.wordsLimit = WORDS_LIMIT_MAP[resolvedPlanKey];
  } else if (priceId) {
    console.warn(
      "[Stripe Webhook] customer.subscription.updated: unknown price id, keeping existing plan",
      priceId
    );
  }

  const updatedSubscription = await db.subscription.update({
    where: { stripeSubscriptionId: subscription.id },
    data: updateData,
    select: { organizationId: true, plan: true },
  });

  if (resolvedPlanKey) {
    await db.organization.update({
      where: { id: updatedSubscription.organizationId },
      data: { plan: resolvedPlanKey },
    });
  }
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
