import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { BILLING_PLAN_KEYS, BILLING_PLANS, getStripePriceIdFromEnv, type BillingInterval, type BillingPlanKey } from "@/lib/billing-plans";
import { isRealStripeCustomerId } from "@/lib/billing";
import { configuredPriceMatches, stripeSubscriptionEligible } from "@/lib/auto-upgrade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownerContext(organizationId: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const membership = await db.organizationMember.findUnique({
    where: { userId_organizationId: { userId: session.user.id, organizationId } },
    select: { role: true },
  });
  if (membership?.role !== "OWNER") return { error: NextResponse.json({ error: "Owner access required" }, { status: 403 }) };
  return { userId: session.user.id };
}

export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
  const context = await ownerContext(organizationId);
  if (context.error) return context.error;
  const [preference, attempts, notices] = await Promise.all([
    db.autoUpgradePreference.findUnique({ where: { organizationId } }),
    db.autoUpgradeAttempt.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.autoUpgradeNotification.findMany({ where: { organizationId, userId: context.userId }, orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  return NextResponse.json({ preference: preference ?? { enabled: false, maxPlan: "STARTER", maxPriceCents: 0, interval: "monthly" }, attempts, notices },
    { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
  const context = await ownerContext(organizationId);
  if (context.error) return context.error;
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "Invalid preference" }, { status: 400 });
  if (!body.enabled) {
    const preference = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
      const latestMember = await tx.organizationMember.findUnique({ where: { userId_organizationId: { userId: context.userId!, organizationId } }, select: { role: true } });
      if (latestMember?.role !== "OWNER") return null;
      return tx.autoUpgradePreference.upsert({ where: { organizationId },
        create: { organizationId, enabled: false, updatedByUserId: context.userId },
        update: { enabled: false, updatedByUserId: context.userId } });
    });
    if (!preference) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
    return NextResponse.json({ preference }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const maxPlan = body.maxPlan as BillingPlanKey;
  const interval = body.interval as BillingInterval;
  const maxPriceCents = body.maxPriceCents;
  if (body.acknowledgeProration !== true)
    return NextResponse.json({ error: "Confirm the recurring ceiling and possible immediate prorated invoice" }, { status: 400 });
  if (!(BILLING_PLAN_KEYS as readonly string[]).includes(maxPlan) || maxPlan === "FREE" || maxPlan === "ENTERPRISE" ||
      (interval !== "monthly" && interval !== "yearly") || !Number.isSafeInteger(maxPriceCents) || maxPriceCents <= 0)
    return NextResponse.json({ error: "Choose a paid plan and a positive EUR price ceiling" }, { status: 400 });
  const [org, sub] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { plan: true } }),
    db.subscription.findUnique({ where: { organizationId } }),
  ]);
  const currentPlan = org?.plan === "PROFESSIONAL" ? "PRO" : org?.plan;
  const currentIndex = BILLING_PLAN_KEYS.indexOf(currentPlan as BillingPlanKey);
  const maxIndex = BILLING_PLAN_KEYS.indexOf(maxPlan);
  if (!org || !sub || sub.status !== "ACTIVE" || !isRealStripeCustomerId(sub.stripeCustomerId) ||
      !sub.stripeSubscriptionId || !sub.stripePriceId || currentIndex < 1 || maxIndex <= currentIndex)
    return NextResponse.json({ error: "An active eligible paid Stripe subscription is required" }, { status: 409 });
  const currentPriceId = getStripePriceIdFromEnv(currentPlan as BillingPlanKey, interval);
  if (!currentPriceId || currentPriceId !== sub.stripePriceId)
    return NextResponse.json({ error: "Current Stripe price or billing interval differs" }, { status: 409 });
  // The owner explicitly authorizes a recurring price ceiling for every possible step.
  for (let index = currentIndex + 1; index <= maxIndex; index++) {
    const plan = BILLING_PLAN_KEYS[index];
    const cents = interval === "monthly" ? BILLING_PLANS[plan].monthlyPriceCents : BILLING_PLANS[plan].yearlyPriceCents;
    const id = getStripePriceIdFromEnv(plan, interval);
    if (!id || cents === null || cents > maxPriceCents)
      return NextResponse.json({ error: "The ceiling does not cover every selected plan" }, { status: 409 });
    const price = await stripe.prices.retrieve(id);
    if (!configuredPriceMatches(price, id, cents, interval))
      return NextResponse.json({ error: "Configured Stripe price differs from the displayed EUR price" }, { status: 409 });
  }
  const remote = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  if (!stripeSubscriptionEligible(remote, currentPriceId, sub.stripeCustomerId))
    return NextResponse.json({ error: "Stripe subscription has a pending or incompatible change" }, { status: 409 });
  const currentCents = interval === "monthly" ? BILLING_PLANS[currentPlan as BillingPlanKey].monthlyPriceCents : BILLING_PLANS[currentPlan as BillingPlanKey].yearlyPriceCents;
  const price = await stripe.prices.retrieve(currentPriceId);
  if (currentCents === null || !configuredPriceMatches(price, currentPriceId, currentCents, interval))
    return NextResponse.json({ error: "Current Stripe price differs from the displayed EUR price" }, { status: 409 });
  const preference = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
    const latestMember = await tx.organizationMember.findUnique({ where: { userId_organizationId: { userId: context.userId!, organizationId } }, select: { role: true } });
    const latestOrg = await tx.organization.findUnique({ where: { id: organizationId }, select: { plan: true } });
    const latestSub = await tx.subscription.findUnique({ where: { organizationId } });
    if (latestMember?.role !== "OWNER" || latestOrg?.plan !== org.plan || latestSub?.stripePriceId !== sub.stripePriceId ||
        latestSub?.status !== "ACTIVE" || latestSub.stripeSubscriptionId !== sub.stripeSubscriptionId) return null;
    return tx.autoUpgradePreference.upsert({ where: { organizationId },
      create: { organizationId, enabled: true, maxPlan, maxPriceCents, interval, updatedByUserId: context.userId },
      update: { enabled: true, maxPlan, maxPriceCents, interval, updatedByUserId: context.userId } });
  });
  if (!preference) return NextResponse.json({ error: "Billing context changed; refresh and try again" }, { status: 409 });
  return NextResponse.json({ preference }, { headers: { "Cache-Control": "private, no-store" } });
}
