import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { BILLING_PLANS, getStripePriceIdFromEnv, resolveBillingPlanKey, type BillingInterval, type BillingPlanKey } from "@/lib/billing-plans";
import { isRealStripeCustomerId } from "@/lib/billing";
import { chooseAutoUpgrade } from "@/lib/auto-upgrade-policy";
import { paidInvoiceMatchesAttempt, type UpgradeInvoiceProof, type UpgradeRemoteSubscription } from "@/lib/auto-upgrade-invoice";

export type AutoUpgradeClient = Pick<PrismaClient, "$transaction" | "organization" | "subscription" | "autoUpgradeAttempt" | "autoUpgradePreference" | "organizationMember" | "usageRecord" | "autoUpgradeNotification" | "billingCommand">;
export type AutoUpgradeStripe = Pick<Stripe, "subscriptions" | "prices" | "invoices">;
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

function recurringCents(plan: BillingPlanKey, interval: BillingInterval) {
  return interval === "monthly" ? BILLING_PLANS[plan].monthlyPriceCents : BILLING_PLANS[plan].yearlyPriceCents;
}

export function configuredPriceMatches(price: Stripe.Price, expectedId: string, expectedCents: number, interval: BillingInterval): boolean {
  return price.id === expectedId && price.active && price.currency.toLowerCase() === "eur" &&
    price.unit_amount === expectedCents && price.recurring?.interval === (interval === "monthly" ? "month" : "year") &&
    (price.recurring?.interval_count ?? 1) === 1 && price.billing_scheme === "per_unit";
}

export function stripeSubscriptionEligible(sub: Stripe.Subscription, expectedId: string, customerId: string): boolean {
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  return sub.status === "active" && customer === customerId && sub.collection_method === "charge_automatically" &&
    !sub.cancel_at_period_end && !sub.cancel_at && !sub.pending_update && !sub.schedule &&
    sub.items.data.length === 1 && sub.items.data[0].price.id === expectedId && sub.items.data[0].quantity === 1;
}

/** The same validation is used at opt-in and immediately before a paid change. */
export async function validateStripeBillingContext(input: {
  client: AutoUpgradeStripe;
  subscriptionId: string;
  customerId: string;
  fromPriceId: string;
  toPriceId: string;
  fromPlan: BillingPlanKey;
  toPlan: BillingPlanKey;
  interval: BillingInterval;
}) {
  const sub = await input.client.subscriptions.retrieve(input.subscriptionId);
  if (!stripeSubscriptionEligible(sub, input.fromPriceId, input.customerId)) return null;
  const fromCents = recurringCents(input.fromPlan, input.interval);
  const toCents = recurringCents(input.toPlan, input.interval);
  if (fromCents === null || toCents === null) return null;
  const [fromPrice, toPrice] = await Promise.all([
    input.client.prices.retrieve(input.fromPriceId), input.client.prices.retrieve(input.toPriceId),
  ]);
  if (!configuredPriceMatches(fromPrice, input.fromPriceId, fromCents, input.interval) ||
      !configuredPriceMatches(toPrice, input.toPriceId, toCents, input.interval)) return null;
  return sub;
}

export async function notifyOwners(client: AutoUpgradeClient, attemptId: string, organizationId: string, kind: "ATTEMPTED" | "APPLIED" | "PAYMENT_ACTION_REQUIRED" | "FAILED" | "RECONCILE_REQUIRED") {
  // Serialize with org-member role changes (#267). A revoked owner cannot get
  // a new billing notice after the role change commits.
  await client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
    const owners = await tx.organizationMember.findMany({ where: { organizationId, role: "OWNER" }, select: { userId: true } });
    await tx.autoUpgradeNotification.createMany({ data: owners.map(({ userId }) => ({ attemptId, userId, organizationId, kind })), skipDuplicates: true });
  });
}

/** Called only after accepted measured usage was persisted. Never blocks translation availability. */
export async function maybeAutoUpgradeAfterUsage(organizationId: string, month: number, dependencies: { client?: AutoUpgradeClient; stripeClient?: AutoUpgradeStripe; now?: Date; env?: Record<string, string | undefined> } = {}) {
  const client = dependencies.client ?? db;
  const stripeClient = dependencies.stripeClient ?? (await import("@/lib/stripe")).stripe;
  const now = dependencies.now ?? new Date();
  const env = dependencies.env ?? process.env;
  // An already dispatched charge must be reconciled even if the owner has
  // since opted out. Opt-out prevents new dispatches, not paid webhook proof.
  const unresolved = await client.autoUpgradeAttempt.findFirst({ where: { organizationId, month,
    status: { in: ["PAYMENT_PENDING", "AWAIT_INVOICE"] } }, orderBy: { createdAt: "desc" } });
  if (unresolved?.status === "PAYMENT_PENDING") {
    const remote = await stripeClient.subscriptions.retrieve(unresolved.stripeSubscriptionId);
    if (remote.pending_update) return "payment_pending" as const;
    if (remote.items.data[0]?.price.id === unresolved.fromPriceId) {
      await client.autoUpgradeAttempt.updateMany({ where: { id: unresolved.id, status: "PAYMENT_PENDING" }, data: { status: "EXPIRED" } });
      await notifyOwners(client, unresolved.id, organizationId, "FAILED");
      return "expired" as const;
    }
    if (remote.items.data[0]?.price.id === unresolved.toPriceId) {
      await verifyAndApplyPaidAutoUpgrade(unresolved.stripeSubscriptionId, unresolved.stripeInvoiceId, stripeClient, client);
    }
    return "await_invoice" as const;
  }
  if (unresolved?.status === "AWAIT_INVOICE") {
    await verifyAndApplyPaidAutoUpgrade(unresolved.stripeSubscriptionId, unresolved.stripeInvoiceId, stripeClient, client);
    return "await_invoice" as const;
  }
  const preference = await client.autoUpgradePreference.findUnique({ where: { organizationId } });
  if (!preference?.enabled) return "disabled" as const;
  const [org, subscription, usage] = await Promise.all([
    client.organization.findUnique({ where: { id: organizationId }, select: { plan: true } }),
    client.subscription.findUnique({ where: { organizationId } }),
    client.usageRecord.aggregate({ where: { organizationId, month }, _sum: { words: true } }),
  ]);
  if (!org || !subscription || !isRealStripeCustomerId(subscription.stripeCustomerId)) return "ineligible" as const;
  const interval = preference.interval as BillingInterval;
  if (interval !== "monthly" && interval !== "yearly") return "ineligible" as const;
  const decision = chooseAutoUpgrade({ enabled: preference.enabled, plan: org.plan, maxPlan: preference.maxPlan,
    interval, maxPriceCents: preference.maxPriceCents, usedWords: usage._sum.words ?? 0,
    status: subscription.status, customerId: subscription.stripeCustomerId,
    subscriptionId: subscription.stripeSubscriptionId, cancelAtPeriodEnd: false, hasPendingUpdate: false });
  if (!decision || !subscription.stripeSubscriptionId || !subscription.stripePriceId) return "ineligible" as const;
  const fromPriceId = getStripePriceIdFromEnv(decision.from, interval, env);
  const toPriceId = getStripePriceIdFromEnv(decision.to, interval, env);
  if (!fromPriceId || !toPriceId || subscription.stripePriceId !== fromPriceId) return "configuration_changed" as const;

  // A committed attempt is the durable idempotency key. This transaction serializes competing producers.
  const attempt = await client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
    const freshPreference = await tx.autoUpgradePreference.findUnique({ where: { organizationId } });
    const freshOrg = await tx.organization.findUnique({ where: { id: organizationId }, select: { plan: true } });
    const freshSub = await tx.subscription.findUnique({ where: { organizationId } });
    const freshUsage = await tx.usageRecord.aggregate({ where: { organizationId, month }, _sum: { words: true } });
    if (!freshPreference || !freshOrg || !freshSub || !isRealStripeCustomerId(freshSub.stripeCustomerId) ||
        freshPreference.updatedAt.getTime() !== preference.updatedAt.getTime() ||
        freshSub.stripePriceId !== fromPriceId || freshSub.stripeSubscriptionId !== subscription.stripeSubscriptionId) return null;
    const freshDecision = chooseAutoUpgrade({ enabled: freshPreference.enabled, plan: freshOrg.plan, maxPlan: freshPreference.maxPlan,
      interval: freshPreference.interval as BillingInterval, maxPriceCents: freshPreference.maxPriceCents,
      usedWords: freshUsage._sum.words ?? 0, status: freshSub.status, customerId: freshSub.stripeCustomerId,
      subscriptionId: freshSub.stripeSubscriptionId, cancelAtPeriodEnd: false, hasPendingUpdate: false });
    if (!freshDecision || freshDecision.to !== decision.to || freshDecision.priceCents !== decision.priceCents) return null;
    const existing = await tx.autoUpgradeAttempt.findUnique({ where: { organizationId_month_fromPlan: { organizationId, month, fromPlan: decision.from } } });
    if (existing) return { row: existing, created: false };
    const inFlight = await tx.autoUpgradeAttempt.findFirst({ where: { organizationId,
      status: { in: ["CLAIMED", "DISPATCHING", "AWAIT_INVOICE", "PAYMENT_PENDING", "UNKNOWN"] } } });
    if (inFlight) return null;
    const created = await tx.autoUpgradeAttempt.create({ data: { organizationId, month, fromPlan: decision.from, toPlan: decision.to,
      fromPriceId, toPriceId, interval, maxPriceCents: preference.maxPriceCents, usedWords: freshUsage._sum.words ?? 0,
      stripeSubscriptionId: subscription.stripeSubscriptionId! } });
    return { row: created, created: true };
  });
  if (!attempt) return "configuration_changed" as const;
  const { row, created } = attempt;
  if (row.status === "PAYMENT_PENDING" || row.status === "AWAIT_INVOICE") return "already_claimed" as const;
  if (row.status !== "CLAIMED" && row.status !== "DISPATCHING") return "already_claimed" as const;
  if (!created && now.getTime() - row.claimedAt.getTime() < 10 * 60 * 1000) return "already_claimed" as const;
  if (now.getTime() - row.createdAt.getTime() >= RETRY_WINDOW_MS) {
    await client.autoUpgradeAttempt.updateMany({ where: { id: row.id, status: row.status }, data: {
      status: row.status === "CLAIMED" ? "CANCELED" : "UNKNOWN", errorCode: "KEY_RETENTION_EXPIRED" } });
    await notifyOwners(client, row.id, organizationId, row.status === "CLAIMED" ? "FAILED" : "RECONCILE_REQUIRED");
    return "unknown" as const;
  }
  await notifyOwners(client, row.id, organizationId, "ATTEMPTED");

  try {
    const remote = await stripeClient.subscriptions.retrieve(row.stripeSubscriptionId);
    // After a lost response, a changed remote state could be our request or an
    // independent operator action. Never bind an invoice by guessing latest_invoice.
    if (row.status === "DISPATCHING" && (remote.pending_update || remote.items.data[0]?.price.id !== fromPriceId)) {
      const held = await client.autoUpgradeAttempt.updateMany({ where: { id: row.id, status: "DISPATCHING",
        claimedAt: row.claimedAt }, data: { status: "UNKNOWN", errorCode: "UNBOUND_EXTERNAL_CHANGE" } });
      if (held.count === 0) return "already_claimed" as const;
      await notifyOwners(client, row.id, organizationId, "RECONCILE_REQUIRED");
      return "unknown" as const;
    }
    const verified = await validateStripeBillingContext({ client: stripeClient, subscriptionId: row.stripeSubscriptionId,
      customerId: subscription.stripeCustomerId, fromPriceId, toPriceId, fromPlan: decision.from, toPlan: decision.to, interval });
    if (!verified || (row.stripeItemId && row.stripeItemId !== verified.items.data[0].id)) {
      const terminal = row.status === "DISPATCHING" ? "UNKNOWN" : "CANCELED";
      const held = await client.autoUpgradeAttempt.updateMany({ where: { id: row.id,
        status: row.status, claimedAt: row.claimedAt }, data: {
        status: terminal, errorCode: "STRIPE_VALIDATION_CHANGED" } });
      if (held.count === 0) return "already_claimed" as const;
      await notifyOwners(client, row.id, organizationId, terminal === "UNKNOWN" ? "RECONCILE_REQUIRED" : "FAILED");
      return terminal === "UNKNOWN" ? "unknown" as const : "canceled" as const;
    }
    // Linearization point: the owner preference and usage are reread under the
    // organization lock, then DISPATCHING is committed. No database lock spans HTTP.
    const dispatch = await client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
      const freshPreference = await tx.autoUpgradePreference.findUnique({ where: { organizationId } });
      const freshSub = await tx.subscription.findUnique({ where: { organizationId } });
      const freshOrg = await tx.organization.findUnique({ where: { id: organizationId }, select: { plan: true } });
      const freshAttempt = await tx.autoUpgradeAttempt.findUnique({ where: { id: row.id } });
      const freshUsage = await tx.usageRecord.aggregate({ where: { organizationId, month }, _sum: { words: true } });
      const ownerCount = await tx.organizationMember.count({ where: { organizationId, role: "OWNER" } });
      const author = freshPreference?.updatedByUserId ? await tx.organizationMember.findUnique({ where: {
        userId_organizationId: { userId: freshPreference.updatedByUserId, organizationId } }, select: { role: true } }) : null;
      const laterBillingCommand = await tx.billingCommand.findFirst({ where: { workspaceId: organizationId,
        action: { not: "AUTO_UPGRADE" }, createdAt: { gt: freshPreference?.updatedAt ?? new Date(0) } }, select: { id: true } });
      if (!freshAttempt || freshAttempt.claimedAt.getTime() !== row.claimedAt.getTime() ||
          (freshAttempt.status !== "CLAIMED" && freshAttempt.status !== "DISPATCHING")) return false;
      if (!freshPreference?.enabled || freshPreference.updatedAt.getTime() !== preference.updatedAt.getTime() ||
          freshPreference.maxPriceCents < decision.priceCents || (freshOrg?.plan === "PROFESSIONAL" ? "PRO" : freshOrg?.plan) !== decision.from ||
          freshSub?.status !== "ACTIVE" || freshSub.stripeSubscriptionId !== subscription.stripeSubscriptionId ||
          freshSub.stripePriceId !== fromPriceId || !isRealStripeCustomerId(freshSub.stripeCustomerId) ||
          ownerCount === 0 || author?.role !== "OWNER" || laterBillingCommand ||
          (freshAttempt.status === "DISPATCHING" && !freshAttempt.billingCommandId) ||
          (freshUsage._sum.words ?? 0) < Math.ceil(BILLING_PLANS[decision.from].wordsLimit * 0.9)) return false;
      const command = freshAttempt.billingCommandId ? null : await tx.billingCommand.create({ data: {
        workspaceId: organizationId, actorUserId: freshPreference.updatedByUserId!, actorRole: "OWNER",
        action: "AUTO_UPGRADE", targetRef: toPriceId,
      } });
      await tx.autoUpgradeAttempt.update({ where: { id: row.id }, data: { status: "DISPATCHING", stripeItemId: verified.items.data[0].id,
        claimedAt: now, billingCommandId: command?.id ?? freshAttempt.billingCommandId } });
      return true;
    });
    if (!dispatch) {
      // A CLAIMED row has never crossed the external boundary. A DISPATCHING
      // row may already have charged Stripe: stop retries and hold it for
      // manual reconciliation rather than releasing it as an ordinary cancel.
      const terminal = row.status === "DISPATCHING" ? "UNKNOWN" : "CANCELED";
      const held = await client.autoUpgradeAttempt.updateMany({ where: { id: row.id, status: row.status,
        claimedAt: row.claimedAt }, data: {
        status: terminal, errorCode: "DISPATCH_AUTHORITY_CHANGED" } });
      if (held.count === 0) return "already_claimed" as const;
      await notifyOwners(client, row.id, organizationId, terminal === "UNKNOWN" ? "RECONCILE_REQUIRED" : "FAILED");
      return terminal === "UNKNOWN" ? "unknown" as const : "canceled" as const;
    }
    const updated = await stripeClient.subscriptions.update(row.stripeSubscriptionId, {
      items: [{ id: verified.items.data[0].id, price: toPriceId }],
      payment_behavior: "pending_if_incomplete", proration_behavior: "always_invoice",
    }, { idempotencyKey: `deepglot-auto-upgrade-${row.id}` });
    const invoiceId = typeof updated.latest_invoice === "string" ? updated.latest_invoice : updated.latest_invoice?.id ?? null;
    if (!invoiceId) {
      await client.autoUpgradeAttempt.updateMany({ where: { id: row.id, status: "DISPATCHING" }, data: { status: "UNKNOWN", errorCode: "NO_UPGRADE_INVOICE" } });
      await notifyOwners(client, row.id, organizationId, "RECONCILE_REQUIRED");
      return "unknown" as const;
    }
    await client.autoUpgradeAttempt.updateMany({ where: { id: row.id, status: "DISPATCHING" }, data: {
      status: updated.pending_update ? "PAYMENT_PENDING" : "AWAIT_INVOICE", stripeInvoiceId: invoiceId, errorCode: null,
    } });
    if (updated.pending_update) {
      await notifyOwners(client, row.id, organizationId, "PAYMENT_ACTION_REQUIRED");
      return "payment_pending" as const;
    }
    await verifyAndApplyPaidAutoUpgrade(row.stripeSubscriptionId, invoiceId, stripeClient, client);
    return "await_invoice" as const;
  } catch (error) {
    console.error("[auto-upgrade] Stripe outcome requires reconciliation", { attemptId: row.id, error });
    await client.autoUpgradeAttempt.updateMany({ where: { id: row.id, status: "DISPATCHING" }, data: { errorCode: "UNKNOWN_EXTERNAL_OUTCOME" } });
    return "unknown" as const;
  }
}

export async function verifyAndApplyPaidAutoUpgrade(subscriptionId: string, invoiceId: string | null,
  stripeClient: AutoUpgradeStripe, client: AutoUpgradeClient = db) {
  if (!invoiceId) return false;
  const attempt = await client.autoUpgradeAttempt.findFirst({ where: { stripeSubscriptionId: subscriptionId, stripeInvoiceId: invoiceId,
    status: { in: ["AWAIT_INVOICE", "PAYMENT_PENDING"] } }, orderBy: { createdAt: "desc" } });
  if (!attempt) return false;
  const tracked = await client.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
  if (!tracked || tracked.organizationId !== attempt.organizationId || !isRealStripeCustomerId(tracked.stripeCustomerId)) return false;
  // All Stripe I/O stays outside the database transaction. We validate the
  // exact bound invoice, customer, subscription, target price and invoice line.
  const [remote, invoice, lines] = await Promise.all([
    stripeClient.subscriptions.retrieve(subscriptionId),
    stripeClient.invoices.retrieve(invoiceId),
    stripeClient.invoices.listLineItems(invoiceId, { limit: 100 }),
  ]);
  const remoteCustomer = typeof remote.customer === "string" ? remote.customer : remote.customer.id;
  const remoteLatestInvoice = typeof remote.latest_invoice === "string" ? remote.latest_invoice : remote.latest_invoice?.id ?? null;
  const remoteProof: UpgradeRemoteSubscription = { id: remote.id, customer: remoteCustomer, status: remote.status,
    priceId: remote.items.data[0]?.price.id ?? null, latestInvoiceId: remoteLatestInvoice, pendingUpdate: Boolean(remote.pending_update) };
  const invoiceCustomer = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
  const parent = invoice.parent as (Stripe.Invoice.Parent & { subscription_details?: { subscription?: string | Stripe.Subscription } }) | null;
  const parentSub = parent?.subscription_details?.subscription;
  const invoiceSubscriptionId = typeof parentSub === "string" ? parentSub : parentSub?.id ?? null;
  const priceIds = lines.data.map((line) => {
    const pricing = line.pricing as { price_details?: { price?: string } } | null;
    return pricing?.price_details?.price ?? null;
  }).filter((value): value is string => Boolean(value));
  const invoiceProof: UpgradeInvoiceProof = { id: invoice.id, customer: invoiceCustomer,
    subscriptionId: invoiceSubscriptionId, status: invoice.status, billingReason: invoice.billing_reason, priceIds };
  if (!paidInvoiceMatchesAttempt(attempt, tracked.stripeCustomerId, remoteProof, invoiceProof)) return false;

  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${attempt.organizationId} FOR UPDATE`;
    const freshAttempt = await tx.autoUpgradeAttempt.findUnique({ where: { id: attempt.id } });
    const freshSub = await tx.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
    if (!freshAttempt || !["AWAIT_INVOICE", "PAYMENT_PENDING"].includes(freshAttempt.status) ||
        freshAttempt.stripeInvoiceId !== invoiceId || freshAttempt.toPriceId !== remoteProof.priceId ||
        !freshSub || freshSub.organizationId !== attempt.organizationId || freshSub.stripeCustomerId !== invoiceCustomer ||
        resolveBillingPlanKey(freshSub.plan) !== freshAttempt.fromPlan || freshSub.stripePriceId !== freshAttempt.fromPriceId) return false;
    await tx.subscription.update({ where: { id: freshSub.id }, data: { status: "ACTIVE", plan: freshAttempt.toPlan,
      wordsLimit: BILLING_PLANS[freshAttempt.toPlan as BillingPlanKey].wordsLimit, stripePriceId: freshAttempt.toPriceId,
      stripeCurrentPeriodEnd: remote.items.data[0]?.current_period_end ? new Date(remote.items.data[0].current_period_end * 1000) : null } });
    await tx.organization.update({ where: { id: attempt.organizationId }, data: { plan: freshAttempt.toPlan } });
    await tx.autoUpgradeAttempt.update({ where: { id: attempt.id }, data: { status: "APPLIED", errorCode: null } });
    const owners = await tx.organizationMember.findMany({ where: { organizationId: attempt.organizationId, role: "OWNER" }, select: { userId: true } });
    await tx.autoUpgradeNotification.createMany({ data: owners.map(({ userId }) => ({ attemptId: attempt.id,
      userId, organizationId: attempt.organizationId, kind: "APPLIED" })), skipDuplicates: true });
    return true;
  });
}

export async function activeAutoUpgradeAttempt(subscriptionId: string, client: AutoUpgradeClient = db) {
  return client.autoUpgradeAttempt.findFirst({ where: { stripeSubscriptionId: subscriptionId,
    status: { in: ["CLAIMED", "DISPATCHING", "AWAIT_INVOICE", "PAYMENT_PENDING", "UNKNOWN", "EXPIRED"] } }, orderBy: { createdAt: "desc" } });
}

export async function expireAutoUpgradePendingUpdate(subscriptionId: string, client: AutoUpgradeClient = db) {
  const attempt = await client.autoUpgradeAttempt.findFirst({ where: { stripeSubscriptionId: subscriptionId,
    status: "PAYMENT_PENDING" }, orderBy: { createdAt: "desc" } });
  if (!attempt) return false;
  await client.autoUpgradeAttempt.updateMany({ where: { id: attempt.id, status: "PAYMENT_PENDING" }, data: { status: "EXPIRED" } });
  await notifyOwners(client, attempt.id, attempt.organizationId, "FAILED");
  return true;
}
