import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import type Stripe from "stripe";
import type { ProfessionalOrderStripe } from "../../src/lib/professional-order-stripe";

const testUrl = process.env.DEEPGLOT_ORDER_TEST_DATABASE_URL;
const allowed = testUrl?.startsWith("postgresql://andreas@127.0.0.1:55472/postgres");
after(async () => { if (allowed) await (await import("../../src/lib/db")).db.$disconnect(); });

test("completed historical order keeps provenance while its project transfers and is deleted", { skip: !allowed }, async () => {
  process.env.DEEPGLOT_DATABASE_URL = testUrl;
  for (const key of ["PROFESSIONAL_ORDERS_ENABLED", "PROFESSIONAL_ORDERS_LEGAL_ACCEPTED", "PROFESSIONAL_ORDERS_PRIVACY_ACCEPTED", "PROFESSIONAL_ORDERS_BILLING_ACCEPTED", "PROFESSIONAL_ORDERS_PRODUCTION_ACCEPTED"]) process.env[key] = "true";
  const { db } = await import("../../src/lib/db");
  const { hashVendorToken } = await import("../../src/lib/professional-orders");
  const { createProfessionalOrder, issueVendorGrant, vendorQuote, acceptProfessionalQuote, cancelProfessionalOrder } = await import("../../src/lib/professional-order-service");
  const { applyProfessionalStripeEvent } = await import("../../src/lib/professional-order-stripe");
  const suffix = randomUUID();
  const user = await db.user.create({ data: { email: `${suffix}@example.invalid` } });
  const source = await db.organization.create({ data: { name: "Source", slug: `${suffix}-source`, members: { create: { userId: user.id, role: "OWNER" } } } });
  const target = await db.organization.create({ data: { name: "Target", slug: `${suffix}-target` } });
  const project = await db.project.create({ data: { name: "Lifecycle fixture", domain: `${suffix}.example.invalid`, originalLang: "en", organizationId: source.id, languages: { create: { langCode: "de" } } } });
  const translation = await db.translation.create({ data: { projectId: project.id, originalHash: `fixture-${suffix}`, originalText: "Hello world", translatedText: "Hallo Welt", langFrom: "en", langTo: "de", source: "MOCK" } });
  const order = await createProfessionalOrder({ projectId: project.id, requesterId: user.id, targetLanguage: "de", translationIds: [translation.id] });
  const grant = await issueVendorGrant({ orderId: order.id, projectId: project.id, actorId: user.id });
  const savedGrant = await db.professionalTranslationVendorGrant.findUniqueOrThrow({ where: { tokenHash: hashVendorToken(grant.token) } });
  await vendorQuote({ orderId: order.id, vendorGrantId: savedGrant.id, amountMinor: 1200, currency: "EUR", turnaroundDays: 3, expiresAt: new Date(Date.now() + 86_400_000), reference: `quote-${suffix}`, termsVersion: "fixture-v1" });
  await acceptProfessionalQuote({ orderId: order.id, projectId: project.id, actorId: user.id, expectedScopeDigest: order.scopeDigest, expectedQuoteReference: `quote-${suffix}` });
  await cancelProfessionalOrder({ orderId: order.id, projectId: project.id, actorId: user.id });
  assert.equal((await db.professionalTranslationOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "CANCELED");
  const metadata = { orderId: order.id, projectId: project.id, organizationId: source.id, scopeDigest: order.scopeDigest, quoteReference: `quote-${suffix}`, amountMinor: "1200", currency: "EUR" };
  const session = { id: `cs_unexpected_${suffix}`, mode: "payment", payment_status: "paid", amount_total: 1200, currency: "eur", client_reference_id: order.id, metadata, payment_intent: `pi_unexpected_${suffix}` } as unknown as Stripe.Checkout.Session;
  const intent = { id: session.payment_intent, status: "succeeded", amount: 1200, currency: "eur", metadata } as unknown as Stripe.PaymentIntent;
  const fakeStripe = { checkout: { sessions: { retrieve: async () => session } }, paymentIntents: { retrieve: async () => intent } } as unknown as ProfessionalOrderStripe;
  const unexpected = { id: `evt_unexpected_${suffix}`, type: "checkout.session.completed", data: { object: session } } as Stripe.Event;
  await assert.rejects(() => applyProfessionalStripeEvent(unexpected, fakeStripe)); // no durable Checkout dispatch
  await db.project.update({ where: { id: project.id }, data: { organizationId: target.id } });
  await db.project.delete({ where: { id: project.id } });
  const evidence = await db.professionalTranslationOrder.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, events: true } });
  assert.equal(evidence.organizationId, source.id);
  assert.equal(evidence.projectId, project.id);
  assert.equal(evidence.activeProjectId, null);
  assert.ok(evidence.projectDetachedAt);
  assert.equal(evidence.items[0].originalText, "Hello world");
  assert.ok(evidence.events.some((event) => event.kind === "canceled"));

  const expiredProject = await db.project.create({ data: { name: "Expired fixture", domain: `expired-${suffix}.example.invalid`, organizationId: source.id } });
  const expiredOrder = await db.professionalTranslationOrder.create({ data: { projectId: expiredProject.id, activeProjectId: expiredProject.id, organizationId: source.id,
    requesterId: user.id, status: "EXPIRED", sourceLanguage: "en", targetLanguage: "de", scopeDigest: "e".repeat(64), wordCount: 1 } });
  await db.project.update({ where: { id: expiredProject.id }, data: { organizationId: target.id } });
  await db.project.delete({ where: { id: expiredProject.id } });
  assert.equal((await db.professionalTranslationOrder.findUniqueOrThrow({ where: { id: expiredOrder.id } })).activeProjectId, null);
});

test("a dispatched Checkout holds project lifecycle and late payment stays with the source merchant", { skip: !allowed }, async () => {
  process.env.DEEPGLOT_DATABASE_URL = testUrl;
  for (const key of ["PROFESSIONAL_ORDERS_ENABLED", "PROFESSIONAL_ORDERS_LEGAL_ACCEPTED", "PROFESSIONAL_ORDERS_PRIVACY_ACCEPTED", "PROFESSIONAL_ORDERS_BILLING_ACCEPTED", "PROFESSIONAL_ORDERS_PRODUCTION_ACCEPTED"]) process.env[key] = "true";
  const { db } = await import("../../src/lib/db");
  const { applyProfessionalStripeEvent } = await import("../../src/lib/professional-order-stripe");
  const suffix = randomUUID();
  const user = await db.user.create({ data: { email: `${suffix}@example.invalid` } });
  const source = await db.organization.create({ data: { name: "Source", slug: `${suffix}-source` } });
  const target = await db.organization.create({ data: { name: "Target", slug: `${suffix}-target` } });
  const project = await db.project.create({ data: { name: "Unresolved fixture", domain: `${suffix}.example.invalid`, organizationId: source.id } });
  const order = await db.professionalTranslationOrder.create({ data: {
    projectId: project.id, activeProjectId: project.id, organizationId: source.id, requesterId: user.id,
    status: "CANCELED", sourceLanguage: "en", targetLanguage: "de", scopeDigest: "a".repeat(64), wordCount: 2,
    quoteAmountMinor: 1200, quoteCurrency: "EUR", quoteReference: `quote-${suffix}`,
    checkoutRequestKey: `attempt-${suffix}`, checkoutAttemptedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
  } });
  await assert.rejects(() => db.project.update({ where: { id: project.id }, data: { organizationId: target.id } }));
  await assert.rejects(() => db.project.delete({ where: { id: project.id } }));
  const metadata = { orderId: order.id, projectId: project.id, organizationId: source.id, scopeDigest: order.scopeDigest,
    quoteReference: order.quoteReference!, amountMinor: "1200", currency: "EUR" };
  const session = { id: `cs_late_${suffix}`, mode: "payment", payment_status: "paid", amount_total: 1200, currency: "eur",
    client_reference_id: order.id, metadata, payment_intent: `pi_late_${suffix}` } as unknown as Stripe.Checkout.Session;
  const intent = { id: session.payment_intent, status: "succeeded", amount: 1200, currency: "eur", metadata } as unknown as Stripe.PaymentIntent;
  const fakeStripe = { checkout: { sessions: { retrieve: async () => session } }, paymentIntents: { retrieve: async () => intent } } as unknown as ProfessionalOrderStripe;
  const event = { id: `evt_late_${suffix}`, type: "checkout.session.completed", data: { object: session } } as Stripe.Event;
  const applied = await applyProfessionalStripeEvent(event, fakeStripe);
  assert.equal("status" in applied && applied.status, "REFUND_PENDING");
  const outstanding = await db.professionalTranslationOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(outstanding.organizationId, source.id);
  assert.equal(outstanding.projectId, project.id);
  assert.equal(outstanding.stripePaymentIntentId, intent.id);
  await assert.rejects(() => db.project.delete({ where: { id: project.id } }));

  const failedOrder = await db.professionalTranslationOrder.create({ data: {
    projectId: project.id, activeProjectId: project.id, organizationId: source.id, requesterId: user.id,
    status: "FAILED", sourceLanguage: "en", targetLanguage: "de", scopeDigest: "f".repeat(64), wordCount: 2,
    quoteAmountMinor: 1200, quoteCurrency: "EUR", quoteReference: `quote-failed-${suffix}`,
    checkoutRequestKey: `failed-attempt-${suffix}`, checkoutAttemptedAt: new Date(),
  } });
  const failedMetadata = { ...metadata, orderId: failedOrder.id, scopeDigest: failedOrder.scopeDigest, quoteReference: failedOrder.quoteReference! };
  const failedSession = { ...session, id: `cs_failed-${suffix}`, client_reference_id: failedOrder.id,
    payment_intent: `pi_failed-${suffix}`, metadata: failedMetadata } as Stripe.Checkout.Session;
  const failedIntent = { ...intent, id: failedSession.payment_intent, metadata: failedMetadata } as Stripe.PaymentIntent;
  const failedStripe = { checkout: { sessions: { retrieve: async () => failedSession } }, paymentIntents: { retrieve: async () => failedIntent } } as unknown as ProfessionalOrderStripe;
  const failedEvent = { id: `evt_failed-late-${suffix}`, type: "checkout.session.async_payment_succeeded", data: { object: failedSession } } as Stripe.Event;
  const failedResult = await applyProfessionalStripeEvent(failedEvent, failedStripe);
  assert.equal("status" in failedResult && failedResult.status, "REFUND_PENDING");
  assert.equal((await db.professionalTranslationOrder.findUniqueOrThrow({ where: { id: failedOrder.id } })).organizationId, source.id);
});

test("refunded receipt detaches; a later verified dispute still binds to the original merchant", { skip: !allowed }, async () => {
  process.env.DEEPGLOT_DATABASE_URL = testUrl;
  for (const key of ["PROFESSIONAL_ORDERS_ENABLED", "PROFESSIONAL_ORDERS_LEGAL_ACCEPTED", "PROFESSIONAL_ORDERS_PRIVACY_ACCEPTED", "PROFESSIONAL_ORDERS_BILLING_ACCEPTED", "PROFESSIONAL_ORDERS_PRODUCTION_ACCEPTED"]) process.env[key] = "true";
  const { db } = await import("../../src/lib/db");
  const { applyProfessionalStripeEvent } = await import("../../src/lib/professional-order-stripe");
  const suffix = randomUUID();
  const user = await db.user.create({ data: { email: `${suffix}@example.invalid` } });
  const source = await db.organization.create({ data: { name: "Source", slug: `${suffix}-source` } });
  const target = await db.organization.create({ data: { name: "Target", slug: `${suffix}-target` } });
  const project = await db.project.create({ data: { name: "Refunded fixture", domain: `${suffix}.example.invalid`, organizationId: source.id } });
  const order = await db.professionalTranslationOrder.create({ data: {
    projectId: project.id, activeProjectId: project.id, organizationId: source.id, requesterId: user.id,
    status: "REFUNDED", sourceLanguage: "en", targetLanguage: "de", scopeDigest: "b".repeat(64), wordCount: 2,
    quoteAmountMinor: 1200, quoteCurrency: "EUR", quoteReference: `quote-${suffix}`,
    checkoutRequestKey: `attempt-${suffix}`, checkoutAttemptedAt: new Date(),
    stripeCheckoutSessionId: `cs_refunded_${suffix}`, stripePaymentIntentId: `pi_refunded_${suffix}`,
    paymentReference: `pi_refunded_${suffix}`, paidAt: new Date(), refundReference: `ch_refunded_${suffix}`,
  } });
  await db.project.update({ where: { id: project.id }, data: { organizationId: target.id } });
  await db.project.delete({ where: { id: project.id } });
  const detached = await db.professionalTranslationOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(detached.activeProjectId, null);
  assert.equal(detached.organizationId, source.id);
  const metadata = { orderId: order.id, projectId: project.id, organizationId: source.id, scopeDigest: order.scopeDigest,
    quoteReference: order.quoteReference!, amountMinor: "1200", currency: "EUR" };
  let session = { id: order.stripeCheckoutSessionId, mode: "payment", payment_status: "paid", amount_total: 1200, currency: "eur",
    client_reference_id: order.id, metadata, payment_intent: order.stripePaymentIntentId } as unknown as Stripe.Checkout.Session;
  const intent = { id: order.stripePaymentIntentId, status: "succeeded", amount: 1200, currency: "eur", metadata } as unknown as Stripe.PaymentIntent;
  const charge = { id: order.refundReference, payment_intent: order.stripePaymentIntentId, amount: 1200, currency: "eur" } as unknown as Stripe.Charge;
  const dispute = { id: `dp_later_${suffix}`, charge: charge.id, amount: 1200, currency: "eur" } as unknown as Stripe.Dispute;
  const fakeStripe = { checkout: { sessions: { retrieve: async () => session } }, paymentIntents: { retrieve: async () => intent },
    charges: { retrieve: async () => charge }, disputes: { retrieve: async () => dispute } } as unknown as ProfessionalOrderStripe;
  const event = { id: `evt_dispute_later_${suffix}`, type: "charge.dispute.created", data: { object: dispute } } as Stripe.Event;
  session = { ...session, metadata: { ...metadata, organizationId: target.id } } as Stripe.Checkout.Session;
  await assert.rejects(() => applyProfessionalStripeEvent(event, fakeStripe)); // transferred org metadata cannot take ownership
  session = { ...session, metadata } as Stripe.Checkout.Session;
  const applied = await applyProfessionalStripeEvent(event, fakeStripe);
  assert.equal("status" in applied && applied.status, "DISPUTED");
  const evidence = await db.professionalTranslationOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(evidence.organizationId, source.id);
  assert.equal(evidence.projectId, project.id);
  assert.equal(evidence.activeProjectId, null);
});

test("open financial and unknown-owner receipts cannot be orphaned", { skip: !allowed }, async () => {
  process.env.DEEPGLOT_DATABASE_URL = testUrl;
  const { db } = await import("../../src/lib/db");
  const suffix = randomUUID();
  const user = await db.user.create({ data: { email: `${suffix}@example.invalid` } });
  const source = await db.organization.create({ data: { name: "Source", slug: `${suffix}-source` } });
  const target = await db.organization.create({ data: { name: "Target", slug: `${suffix}-target` } });
  for (const status of ["PAYMENT_PENDING", "PAID", "REFUND_PENDING", "DISPUTED", "FAILED", "EXPIRED"] as const) {
    const project = await db.project.create({ data: { name: status, domain: `${status.toLowerCase()}-${suffix}.example.invalid`, organizationId: source.id } });
    await db.professionalTranslationOrder.create({ data: {
      projectId: project.id, activeProjectId: project.id, organizationId: status === "EXPIRED" ? null : source.id,
      requesterId: user.id, status, sourceLanguage: "en", targetLanguage: "de", scopeDigest: "c".repeat(64), wordCount: 1,
    } });
    await assert.rejects(() => db.project.update({ where: { id: project.id }, data: { organizationId: target.id } }));
    await assert.rejects(() => db.project.delete({ where: { id: project.id } }));
  }
});
