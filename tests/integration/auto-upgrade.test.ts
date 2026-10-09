import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { maybeAutoUpgradeAfterUsage, verifyAndApplyPaidAutoUpgrade, type AutoUpgradeStripe } from "@/lib/auto-upgrade";
import { reconcileAutoUpgradeAttempts } from "@/lib/auto-upgrade-reconcile";

test.after(async () => { await db.$disconnect(); });

const env = { STRIPE_PRICE_STARTER_MONTHLY: "price_starter_269", STRIPE_PRICE_BUSINESS_MONTHLY: "price_business_269" };
function price(id: string, cents: number) {
  return { id, active: true, currency: "eur", unit_amount: cents, recurring: { interval: "month", interval_count: 1 }, billing_scheme: "per_unit" } as Stripe.Price;
}

test("real PostgreSQL claim serializes concurrent usage producers and preserves paid-only entitlements", async () => {
  const suffix = randomUUID();
  const owner = await db.user.create({ data: { email: `auto269-${suffix}@example.invalid` } });
  const successor = await db.user.create({ data: { email: `auto269-successor-${suffix}@example.invalid` } });
  const org = await db.organization.create({ data: { name: "Auto fixture", slug: `auto269-${suffix}`, plan: "STARTER" } });
  const subId = `sub_${suffix.replaceAll("-", "")}`;
  const customerId = `cus_${suffix.replaceAll("-", "")}`;
  let remotePrice = env.STRIPE_PRICE_STARTER_MONTHLY;
  let pending = false;
  let updates = 0;
  const keys: string[] = [];
  const remote = () => ({ id: subId, status: "active", customer: customerId, collection_method: "charge_automatically",
    cancel_at_period_end: false, cancel_at: null, pending_update: pending ? { expires_at: 1 } : null, schedule: null,
    items: { data: [{ id: "si_269", quantity: 1, price: { id: remotePrice } }] }, latest_invoice: "in_269" }) as unknown as Stripe.Subscription;
  const stripeClient = { subscriptions: {
    retrieve: async () => remote(),
    update: async (_id: string, _params: unknown, options: { idempotencyKey: string }) => {
      updates++; keys.push(options.idempotencyKey); pending = true;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return remote();
    },
  }, prices: { retrieve: async (id: string) => price(id, id === env.STRIPE_PRICE_STARTER_MONTHLY ? 1300 : 2500) },
  invoices: {
    retrieve: async () => ({ id: "in_269", customer: customerId, parent: { subscription_details: { subscription: subId } }, status: "paid", billing_reason: "subscription_update" }),
    listLineItems: async () => ({ data: [{ pricing: { price_details: { price: env.STRIPE_PRICE_BUSINESS_MONTHLY } } }] }),
  } } as unknown as AutoUpgradeStripe;
  try {
    await db.organizationMember.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    const project = await db.project.create({ data: { name: "Auto project", domain: `auto269-${suffix}.invalid`, organizationId: org.id } });
    await db.subscription.create({ data: { organizationId: org.id, stripeCustomerId: customerId, stripeSubscriptionId: subId,
      stripePriceId: env.STRIPE_PRICE_STARTER_MONTHLY, status: "ACTIVE", plan: "STARTER", wordsLimit: 25000 } });
    await db.usageRecord.create({ data: { organizationId: org.id, projectId: project.id, month: 202610, words: 22500 } });
    const inputs = { stripeClient, env };
    assert.equal(await maybeAutoUpgradeAfterUsage(org.id, 202610, inputs), "disabled");
    await db.autoUpgradePreference.create({ data: { organizationId: org.id, enabled: true, maxPlan: "BUSINESS", maxPriceCents: 2500 } });
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => maybeAutoUpgradeAfterUsage(org.id, 202610, inputs)));
    assert.equal(outcomes.filter((outcome) => outcome === "payment_pending").length, 1);
    assert.equal(updates, 1);
    assert.equal(new Set(keys).size, 1);
    const attempt = await db.autoUpgradeAttempt.findFirstOrThrow({ where: { organizationId: org.id } });
    assert.equal(attempt.status, "PAYMENT_PENDING");
    assert.equal(await db.autoUpgradeNotification.count({ where: { attemptId: attempt.id, kind: "ATTEMPTED", userId: owner.id } }), 1);
    assert.equal(await db.autoUpgradeNotification.count({ where: { attemptId: attempt.id, kind: "PAYMENT_ACTION_REQUIRED", userId: owner.id } }), 1);
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { organizationId: org.id } })).wordsLimit, 25000);
    assert.equal((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).plan, "STARTER");
    assert.equal(await maybeAutoUpgradeAfterUsage(org.id, 202610, inputs), "payment_pending");
    assert.equal(updates, 1);
    assert.equal(await verifyAndApplyPaidAutoUpgrade(subId, "in_269", stripeClient), false);
    await db.organizationMember.update({ where: { userId_organizationId: { userId: owner.id, organizationId: org.id } }, data: { role: "MEMBER" } });
    await db.organizationMember.create({ data: { userId: successor.id, organizationId: org.id, role: "OWNER" } });
    remotePrice = env.STRIPE_PRICE_BUSINESS_MONTHLY;
    pending = false;
    assert.equal(await verifyAndApplyPaidAutoUpgrade(subId, "in_269", stripeClient), true);
    assert.equal(await verifyAndApplyPaidAutoUpgrade(subId, "in_269", stripeClient), false);
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { organizationId: org.id } })).wordsLimit, 50000);
    assert.equal((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).plan, "BUSINESS");
    assert.equal(await db.autoUpgradeNotification.count({ where: { attemptId: attempt.id, kind: "APPLIED", userId: owner.id } }), 0);
    assert.equal(await db.autoUpgradeNotification.count({ where: { attemptId: attempt.id, kind: "APPLIED", userId: successor.id } }), 1);
    await db.autoUpgradePreference.update({ where: { organizationId: org.id }, data: { enabled: false } });
    assert.equal(await maybeAutoUpgradeAfterUsage(org.id, 202610, inputs), "disabled");
  } finally {
    await db.organization.delete({ where: { id: org.id } });
    await db.user.delete({ where: { id: owner.id } });
    await db.user.delete({ where: { id: successor.id } });
  }
});

test("unknown response retries the same key once, and an expired pending payment releases the hold without another charge", async () => {
  const suffix = randomUUID();
  const owner = await db.user.create({ data: { email: `auto269-retry-${suffix}@example.invalid` } });
  const org = await db.organization.create({ data: { name: "Auto retry", slug: `auto269-retry-${suffix}`, plan: "STARTER" } });
  const customerId = `cus_${suffix.replaceAll("-", "")}`;
  const subId = `sub_${suffix.replaceAll("-", "")}`;
  let pending = false;
  let updates = 0;
  const keys: string[] = [];
  const remote = () => ({ id: subId, status: "active", customer: customerId, collection_method: "charge_automatically",
    cancel_at_period_end: false, cancel_at: null, pending_update: pending ? { expires_at: 1 } : null, schedule: null,
    items: { data: [{ id: "si_retry", quantity: 1, price: { id: env.STRIPE_PRICE_STARTER_MONTHLY } }] }, latest_invoice: "in_retry" }) as unknown as Stripe.Subscription;
  const stripeClient = { subscriptions: { retrieve: async () => remote(),
    update: async (_id: string, _params: unknown, options: { idempotencyKey: string }) => {
      updates++; keys.push(options.idempotencyKey);
      if (updates === 1) throw new Error("lost response");
      pending = true;
      return remote();
    } }, prices: { retrieve: async (id: string) => price(id, id === env.STRIPE_PRICE_STARTER_MONTHLY ? 1300 : 2500) } } as unknown as AutoUpgradeStripe;
  try {
    await db.organizationMember.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    const project = await db.project.create({ data: { name: "Retry project", domain: `auto269-retry-${suffix}.invalid`, organizationId: org.id } });
    await db.subscription.create({ data: { organizationId: org.id, stripeCustomerId: customerId, stripeSubscriptionId: subId,
      stripePriceId: env.STRIPE_PRICE_STARTER_MONTHLY, status: "ACTIVE", plan: "STARTER", wordsLimit: 25000 } });
    await db.autoUpgradePreference.create({ data: { organizationId: org.id, enabled: true, maxPlan: "BUSINESS", maxPriceCents: 2500 } });
    await db.usageRecord.create({ data: { organizationId: org.id, projectId: project.id, month: 202610, words: 23000 } });
    const start = new Date();
    const input = { stripeClient, env };
    assert.equal(await maybeAutoUpgradeAfterUsage(org.id, 202610, { ...input, now: start }), "unknown");
    assert.equal(await maybeAutoUpgradeAfterUsage(org.id, 202610, { ...input, now: start }), "already_claimed");
    assert.equal(updates, 1);
    const scheduled = await reconcileAutoUpgradeAttempts({ ...input, now: new Date(start.getTime() + 11 * 60_000) });
    assert.equal(scheduled.results.payment_pending, 1);
    assert.equal(updates, 2);
    assert.equal(keys[0], keys[1]);
    pending = false;
    await db.autoUpgradePreference.update({ where: { organizationId: org.id }, data: { enabled: false } });
    assert.equal((await reconcileAutoUpgradeAttempts(input)).results.expired, 1);
    assert.equal(updates, 2);
    assert.equal((await db.autoUpgradeAttempt.findFirstOrThrow({ where: { organizationId: org.id } })).status, "EXPIRED");
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { organizationId: org.id } })).wordsLimit, 25000);
  } finally {
    await db.organization.delete({ where: { id: org.id } });
    await db.user.delete({ where: { id: owner.id } });
  }
});

test("legacy PROFESSIONAL plan applies a paid PRO to ADVANCED upgrade atomically", async () => {
  const suffix = randomUUID();
  const owner = await db.user.create({ data: { email: `auto269-legacy-${suffix}@example.invalid` } });
  const org = await db.organization.create({ data: { name: "Legacy auto", slug: `auto269-legacy-${suffix}`, plan: "PROFESSIONAL" } });
  const customerId = `cus_${suffix.replaceAll("-", "")}`;
  const subId = `sub_${suffix.replaceAll("-", "")}`;
  const proPrice = "price_pro_269";
  const advancedPrice = "price_advanced_269";
  let remotePrice = proPrice;
  let invoiceStatus = "open";
  const remote = () => ({ id: subId, status: "active", customer: customerId, collection_method: "charge_automatically",
    cancel_at_period_end: false, cancel_at: null, pending_update: null, schedule: null,
    items: { data: [{ id: "si_legacy", quantity: 1, price: { id: remotePrice } }] }, latest_invoice: "in_legacy_269" }) as unknown as Stripe.Subscription;
  const stripeClient = { subscriptions: { retrieve: async () => remote(),
    update: async () => { remotePrice = advancedPrice; return remote(); } },
  prices: { retrieve: async (id: string) => price(id, id === proPrice ? 6900 : 25900) },
  invoices: {
    retrieve: async () => ({ id: "in_legacy_269", customer: customerId, parent: { subscription_details: { subscription: subId } }, status: invoiceStatus, billing_reason: "subscription_update" }),
    listLineItems: async () => ({ data: [{ pricing: { price_details: { price: advancedPrice } } }] }),
  } } as unknown as AutoUpgradeStripe;
  try {
    await db.organizationMember.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    const project = await db.project.create({ data: { name: "Legacy project", domain: `auto269-legacy-${suffix}.invalid`, organizationId: org.id } });
    await db.subscription.create({ data: { organizationId: org.id, stripeCustomerId: customerId, stripeSubscriptionId: subId,
      stripePriceId: proPrice, status: "ACTIVE", plan: "PROFESSIONAL", wordsLimit: 200000 } });
    await db.autoUpgradePreference.create({ data: { organizationId: org.id, enabled: true, maxPlan: "ADVANCED", maxPriceCents: 25900 } });
    await db.usageRecord.create({ data: { organizationId: org.id, projectId: project.id, month: 202610, words: 180000 } });
    await maybeAutoUpgradeAfterUsage(org.id, 202610, { stripeClient, env: { STRIPE_PRICE_PRO_MONTHLY: proPrice, STRIPE_PRICE_ADVANCED_MONTHLY: advancedPrice } });
    const attempt = await db.autoUpgradeAttempt.findFirstOrThrow({ where: { organizationId: org.id } });
    assert.equal(attempt.fromPlan, "PRO");
    assert.equal(attempt.toPlan, "ADVANCED");
    assert.equal(attempt.status, "AWAIT_INVOICE");
    invoiceStatus = "paid";
    assert.equal(await verifyAndApplyPaidAutoUpgrade(subId, "in_legacy_269", stripeClient), true);
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { organizationId: org.id } })).plan, "ADVANCED");
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { organizationId: org.id } })).wordsLimit, 1000000);
    assert.equal((await db.autoUpgradeAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status, "APPLIED");
  } finally {
    await db.organization.delete({ where: { id: org.id } });
    await db.user.delete({ where: { id: owner.id } });
  }
});
