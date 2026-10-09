import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import type Stripe from "stripe";
import type { ProfessionalOrderStripe } from "../../src/lib/professional-order-stripe";

const testUrl = process.env.DEEPGLOT_ORDER_TEST_DATABASE_URL;
const allowed = testUrl?.startsWith("postgresql://andreas@127.0.0.1:55472/postgres");
after(async () => { if (allowed) await (await import("../../src/lib/db")).db.$disconnect(); });

function fakeEvent(type: Stripe.Event.Type, id: string, object: object): Stripe.Event {
  return { id, type, data: { object } } as Stripe.Event;
}
function statusOf(result: { status: string } | { ignored: boolean }) {
  if (!("status" in result)) throw new Error("Expected a handled payment event");
  return result.status;
}

test("one-time Checkout binds quote, survives lost response and settles only verified signed-event input", { skip: !allowed }, async () => {
  process.env.DEEPGLOT_DATABASE_URL = testUrl;
  for (const key of ["PROFESSIONAL_ORDERS_ENABLED", "PROFESSIONAL_ORDERS_LEGAL_ACCEPTED", "PROFESSIONAL_ORDERS_PRIVACY_ACCEPTED", "PROFESSIONAL_ORDERS_BILLING_ACCEPTED", "PROFESSIONAL_ORDERS_PRODUCTION_ACCEPTED"]) process.env[key] = "true";
  const { db } = await import("../../src/lib/db");
  const { hashVendorToken } = await import("../../src/lib/professional-orders");
  const { createProfessionalOrder, issueVendorGrant, vendorQuote, acceptProfessionalQuote, cancelProfessionalOrder } = await import("../../src/lib/professional-order-service");
  const { beginProfessionalCheckout, applyProfessionalStripeEvent } = await import("../../src/lib/professional-order-stripe");
  const suffix = randomUUID();
  const owner = await db.user.create({ data: { email: `${suffix}@example.invalid` } });
  const admin = await db.user.create({ data: { email: `admin-${suffix}@example.invalid` } });
  const organization = await db.organization.create({ data: { name: "Checkout fixture", slug: suffix, members: { create: [{ userId: owner.id, role: "OWNER" }, { userId: admin.id, role: "MEMBER" }] } } });
  const project = await db.project.create({ data: { name: "Checkout fixture", domain: `${suffix}.example.invalid`, originalLang: "en", organizationId: organization.id,
    languages: { create: { langCode: "de" } }, members: { create: { userId: admin.id, email: admin.email!, role: "ADMIN" } } } });
  const translation = await db.translation.create({ data: { projectId: project.id, originalHash: `fixture-${suffix}`, originalText: "Hello world", translatedText: "Hallo Welt", langFrom: "en", langTo: "de", source: "MOCK" } });
  const order = await createProfessionalOrder({ projectId: project.id, requesterId: owner.id, targetLanguage: "de", translationIds: [translation.id] });
  const grant = await issueVendorGrant({ orderId: order.id, projectId: project.id, actorId: owner.id });
  const savedGrant = await db.professionalTranslationVendorGrant.findUniqueOrThrow({ where: { tokenHash: hashVendorToken(grant.token) } });
  await vendorQuote({ orderId: order.id, vendorGrantId: savedGrant.id, amountMinor: 1200, currency: "EUR", turnaroundDays: 3,
    expiresAt: new Date(Date.now() + 86_400_000), reference: `quote-${suffix}`, termsVersion: "fixture-v1" });
  await acceptProfessionalQuote({ orderId: order.id, projectId: project.id, actorId: owner.id, expectedScopeDigest: order.scopeDigest, expectedQuoteReference: `quote-${suffix}` });
  await db.subscription.create({ data: { organizationId: organization.id, stripeCustomerId: `synthetic-${suffix}` } });
  const meta = { orderId: order.id, projectId: project.id, organizationId: organization.id, scopeDigest: order.scopeDigest,
    quoteReference: `quote-${suffix}`, amountMinor: "1200", currency: "EUR" };
  let session: Stripe.Checkout.Session | null = null;
  let createCount = 0;
  let seenCustomer: unknown;
  let firstKey = "";
  let failAfterCreate = true;
  let wroteWhileStripeWasCalled = false;
  let intent: Stripe.PaymentIntent = { id: `pi_${suffix}`, status: "succeeded", amount: 1200, currency: "eur", metadata: meta } as unknown as Stripe.PaymentIntent;
  const charge: Stripe.Charge = { id: `ch_${suffix}`, payment_intent: intent.id, currency: "eur", amount: 1200, amount_refunded: 1200 } as Stripe.Charge;
  const stripe: ProfessionalOrderStripe = {
    checkout: { sessions: {
      create: async (params, options) => {
        createCount++;
        await db.project.update({ where: { id: project.id }, data: { name: "Checkout HTTP lock probe" } });
        wroteWhileStripeWasCalled = true;
        seenCustomer = params.customer;
        if (firstKey && firstKey !== options.idempotencyKey) throw new Error("different idempotency key");
        firstKey = options.idempotencyKey;
        session ??= { id: `cs_${suffix}`, url: "https://checkout.stripe.com/c/pay/fixture", mode: "payment", payment_status: "unpaid",
          amount_total: 1200, currency: "eur", client_reference_id: order.id, metadata: meta, payment_intent: null } as unknown as Stripe.Checkout.Session;
        if (failAfterCreate) { failAfterCreate = false; throw new Error("lost response"); }
        return session;
      },
      retrieve: async (id) => { assert.equal(id, session?.id); return session!; },
    } },
    paymentIntents: { retrieve: async (id) => { assert.equal(id, intent.id); return intent; } },
    charges: { retrieve: async (id) => { assert.equal(id, charge.id); return charge; } },
    disputes: { retrieve: async (id) => ({ id, charge: charge.id, amount: 1200, currency: "eur" } as Stripe.Dispute) },
  };
  const args = { orderId: order.id, projectId: project.id, actorId: owner.id, returnBaseUrl: "http://localhost:31572" };
  await assert.rejects(() => beginProfessionalCheckout(args, stripe), /lost response/);
  assert.equal(seenCustomer, undefined); // synthetic customer never crosses the Stripe boundary
  assert.equal(wroteWhileStripeWasCalled, true); // no project row lock is held over the provider call
  const retry = await beginProfessionalCheckout(args, stripe);
  assert.match(retry.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(createCount, 2);
  assert.equal(firstKey, (await db.professionalTranslationOrder.findUniqueOrThrow({ where: { id: order.id } })).checkoutRequestKey);
  await assert.rejects(() => db.professionalTranslationOrder.update({ where: { id: order.id }, data: { checkoutRequestKey: `changed-${suffix}` } }));
  const repeated = await beginProfessionalCheckout(args, stripe);
  assert.equal(repeated.url, retry.url);
  assert.equal(createCount, 2);
  assert.equal((await db.professionalTranslationOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "PAYMENT_PENDING");
  const completed = fakeEvent("checkout.session.completed", `evt_paid_${suffix}`, { ...(session as unknown as Stripe.Checkout.Session), payment_status: "paid" });
  assert.equal(statusOf(await applyProfessionalStripeEvent(completed, stripe)), "PAYMENT_PENDING"); // event payload cannot prove payment
  session = { ...session!, payment_status: "paid", payment_intent: intent.id } as Stripe.Checkout.Session;
  intent = { ...intent, amount: 1201 } as Stripe.PaymentIntent;
  await assert.rejects(() => applyProfessionalStripeEvent(completed, stripe)); // immutable amount binding
  intent = { ...intent, amount: 1200 } as Stripe.PaymentIntent;
  await cancelProfessionalOrder({ orderId: order.id, projectId: project.id, actorId: owner.id });
  assert.equal(statusOf(await applyProfessionalStripeEvent(completed, stripe)), "REFUND_PENDING"); // late payment
  assert.equal(statusOf(await applyProfessionalStripeEvent(completed, stripe)), "REFUND_PENDING"); // replay
  session = { ...session, id: `cs_conflict_${suffix}` } as Stripe.Checkout.Session;
  await assert.rejects(() => applyProfessionalStripeEvent(fakeEvent("checkout.session.completed", `evt_conflict_${suffix}`, session!), stripe));
  session = { ...session, id: `cs_${suffix}` } as Stripe.Checkout.Session;
  assert.equal(statusOf(await applyProfessionalStripeEvent(fakeEvent("charge.refunded", `evt_refund_${suffix}`, charge), stripe)), "REFUNDED");
  assert.equal(statusOf(await applyProfessionalStripeEvent(fakeEvent("charge.refunded", `evt_refund_${suffix}`, charge), stripe)), "REFUNDED");
  assert.equal(statusOf(await applyProfessionalStripeEvent(fakeEvent("charge.dispute.created", `evt_dispute_${suffix}`, { id: `dp_${suffix}`, charge: charge.id }), stripe)), "DISPUTED");
  assert.equal((await db.professionalTranslationOrder.findUniqueOrThrow({ where: { id: order.id } })).organizationId, organization.id);
  await assert.rejects(() => db.project.delete({ where: { id: project.id } })); // financial evidence blocks deletion

  const expiredOrder = await createProfessionalOrder({ projectId: project.id, requesterId: owner.id, targetLanguage: "de", translationIds: [translation.id] });
  const expiredGrant = await issueVendorGrant({ orderId: expiredOrder.id, projectId: project.id, actorId: owner.id });
  const expiredSavedGrant = await db.professionalTranslationVendorGrant.findUniqueOrThrow({ where: { tokenHash: hashVendorToken(expiredGrant.token) } });
  await vendorQuote({ orderId: expiredOrder.id, vendorGrantId: expiredSavedGrant.id, amountMinor: 1200, currency: "EUR", turnaroundDays: 3,
    expiresAt: new Date(Date.now() + 86_400_000), reference: `quote-expired-${suffix}`, termsVersion: "fixture-v1" });
  await acceptProfessionalQuote({ orderId: expiredOrder.id, projectId: project.id, actorId: owner.id, expectedScopeDigest: expiredOrder.scopeDigest, expectedQuoteReference: `quote-expired-${suffix}` });
  await db.professionalTranslationOrder.update({ where: { id: expiredOrder.id }, data: { checkoutRequestKey: `expired-${suffix}`, checkoutAttemptedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
  const beforeExpired = createCount;
  await assert.rejects(() => beginProfessionalCheckout({ ...args, orderId: expiredOrder.id }, stripe));
  assert.equal(createCount, beforeExpired);

  // Project ADMIN may pay an accepted order, but an existing workspace
  // customer's hosted billing details must not be attached to that Checkout.
  await db.subscription.update({ where: { organizationId: organization.id }, data: { stripeCustomerId: `cus_fixture_${suffix}` } });
  const adminOrder = await createProfessionalOrder({ projectId: project.id, requesterId: admin.id, targetLanguage: "de", translationIds: [translation.id] });
  const adminGrant = await issueVendorGrant({ orderId: adminOrder.id, projectId: project.id, actorId: admin.id });
  const adminSavedGrant = await db.professionalTranslationVendorGrant.findUniqueOrThrow({ where: { tokenHash: hashVendorToken(adminGrant.token) } });
  await vendorQuote({ orderId: adminOrder.id, vendorGrantId: adminSavedGrant.id, amountMinor: 1200, currency: "EUR", turnaroundDays: 3,
    expiresAt: new Date(Date.now() + 86_400_000), reference: `quote-admin-${suffix}`, termsVersion: "fixture-v1" });
  await acceptProfessionalQuote({ orderId: adminOrder.id, projectId: project.id, actorId: admin.id, expectedScopeDigest: adminOrder.scopeDigest, expectedQuoteReference: `quote-admin-${suffix}` });
  let adminCustomer: unknown = "not-called";
  let adminSession: Stripe.Checkout.Session;
  const adminStripe: ProfessionalOrderStripe = {
    ...stripe, checkout: { sessions: {
      create: async (params) => {
        adminCustomer = params.customer;
        adminSession = { id: `cs_admin_${suffix}`, url: "https://checkout.stripe.com/c/pay/admin-fixture", mode: "payment", payment_status: "unpaid",
          amount_total: 1200, currency: "eur", client_reference_id: adminOrder.id, metadata: params.metadata, payment_intent: null } as unknown as Stripe.Checkout.Session;
        return adminSession;
      }, retrieve: async () => adminSession,
    } },
  };
  await beginProfessionalCheckout({ ...args, orderId: adminOrder.id, actorId: admin.id }, adminStripe);
  assert.equal(adminCustomer, undefined);

  process.env.STRIPE_SECRET_KEY = "sk_test_fixture_local_only";
  process.env.PROFESSIONAL_ORDERS_STRIPE_WEBHOOK_SECRET = "whsec_fixture_local_only";
  const { NextRequest } = await import("next/server");
  const { POST: webhook } = await import("../../src/app/api/webhooks/professional-orders-stripe/route");
  const unsigned = await webhook(new NextRequest("http://localhost/api/webhooks/professional-orders-stripe", {
    method: "POST", headers: { "stripe-signature": "invalid" }, body: JSON.stringify(completed),
  }));
  assert.equal(unsigned.status, 400);
});
