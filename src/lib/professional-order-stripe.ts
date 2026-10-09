import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { isRealStripeCustomerId } from "@/lib/billing";
import { assertProfessionalOrderLanguage, assertProfessionalOrderOwner, lockProfessionalOrderManagerScope } from "@/lib/professional-order-access";
import { ProfessionalOrderError, requireProfessionalOrdersEnabled } from "@/lib/professional-orders";

/** Narrow injectable boundary. Tests supply an in-memory Stripe contract. */
export type ProfessionalOrderStripe = {
  checkout: { sessions: {
    create: (params: Stripe.Checkout.SessionCreateParams, options: { idempotencyKey: string }) => Promise<Stripe.Checkout.Session>;
    retrieve: (id: string) => Promise<Stripe.Checkout.Session>;
  } };
  paymentIntents: { retrieve: (id: string) => Promise<Stripe.PaymentIntent> };
  charges: { retrieve: (id: string) => Promise<Stripe.Charge> };
  disputes: { retrieve: (id: string) => Promise<Stripe.Dispute> };
};

const txOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 15_000 } as const;
const conflict = (message = "Payment identity changed; reconcile before continuing.") => new ProfessionalOrderError("CONFLICT", message);

type PaymentOrder = NonNullable<Awaited<ReturnType<typeof paymentOrder>>>;
function paymentOrder(orderId: string) {
  return db.professionalTranslationOrder.findUnique({ where: { id: orderId }, select: {
    id: true, projectId: true, organizationId: true, status: true, scopeDigest: true,
    quoteReference: true, quoteAmountMinor: true, quoteCurrency: true, quoteExpiresAt: true,
    checkoutRequestKey: true, checkoutAttemptedAt: true, stripeCheckoutSessionId: true,
    stripePaymentIntentId: true, paymentReference: true, paidAt: true,
  } });
}

function orderMetadata(order: PaymentOrder): Record<string, string> {
  if (!order.organizationId || !order.quoteReference || !order.quoteAmountMinor || !order.quoteCurrency) throw conflict("Quote or billing owner is missing.");
  return {
    orderId: order.id, projectId: order.projectId, organizationId: order.organizationId,
    scopeDigest: order.scopeDigest, quoteReference: order.quoteReference,
    amountMinor: String(order.quoteAmountMinor), currency: order.quoteCurrency,
  };
}

function metadataMatches(actual: Stripe.Metadata | null | undefined, expected: Record<string, string>) {
  return Object.entries(expected).every(([key, value]) => actual?.[key] === value);
}

function paymentIntentId(session: Stripe.Checkout.Session) {
  const intent = session.payment_intent;
  return typeof intent === "string" ? intent : intent?.id ?? null;
}

async function verifiedSession(stripe: ProfessionalOrderStripe, order: PaymentOrder, sessionId: string, paid: boolean) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const expected = orderMetadata(order);
  if (session.id !== sessionId || session.mode !== "payment" || session.client_reference_id !== order.id ||
      !metadataMatches(session.metadata, expected) ||
      session.amount_total !== order.quoteAmountMinor || session.currency?.toUpperCase() !== order.quoteCurrency ||
      (order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== session.id)) throw conflict();
  const intentId = paymentIntentId(session);
  if (paid) {
    if (session.payment_status !== "paid" || !intentId) throw conflict("Checkout has not been paid.");
    const intent = await stripe.paymentIntents.retrieve(intentId);
    if (intent.id !== intentId || intent.status !== "succeeded" || intent.amount !== order.quoteAmountMinor ||
        intent.currency.toUpperCase() !== order.quoteCurrency || !metadataMatches(intent.metadata, expected) ||
        (order.stripePaymentIntentId && order.stripePaymentIntentId !== intent.id)) throw conflict();
  } else if (session.payment_status === "paid") {
    throw conflict("A failed event cannot override a paid Checkout.");
  }
  return { session, intentId };
}

/** Persist a single attempt before any HTTP call; retries use its same key. */
export async function beginProfessionalCheckout(
  input: { orderId: string; projectId: string; actorId: string; returnBaseUrl: string },
  stripe: ProfessionalOrderStripe,
) {
  requireProfessionalOrdersEnabled();
  if (!/^https:\/\//.test(input.returnBaseUrl) && !/^http:\/\/localhost(?::\d+)?$/.test(input.returnBaseUrl)) {
    throw new ProfessionalOrderError("INVALID", "Invalid checkout return origin.");
  }
  const reserved = await db.$transaction(async (tx) => {
    const scope = await lockProfessionalOrderManagerScope(tx, input);
    const order = await tx.professionalTranslationOrder.findFirst({ where: { id: input.orderId, projectId: input.projectId, activeProjectId: input.projectId } });
    if (!order) throw new ProfessionalOrderError("NOT_FOUND", "Order not found.");
    assertProfessionalOrderOwner(scope, order.organizationId);
    assertProfessionalOrderLanguage(scope, order.sourceLanguage, order.targetLanguage);
    if (order.status !== "PAYMENT_PENDING" || !order.quoteAmountMinor || !order.quoteCurrency || !order.quoteReference) throw conflict("Accepted quote is not payable.");
    if (order.checkoutAttemptedAt && Date.now() - order.checkoutAttemptedAt.getTime() >= 23 * 60 * 60 * 1000 && !order.stripeCheckoutSessionId) {
      throw conflict("Checkout retry window expired; reconcile the original attempt.");
    }
    const key = order.checkoutRequestKey ?? `professional-order:${order.id}:${randomUUID()}`;
    if (!order.checkoutRequestKey) await tx.professionalTranslationOrder.update({
      where: { id: order.id }, data: { checkoutRequestKey: key, checkoutAttemptedAt: new Date() },
    });
    // A project ADMIN may pay the accepted quote, but must not enter an
    // existing workspace customer's hosted Checkout or see its billing data.
    const mayReuseCustomer = scope.organizationRole === "OWNER" || scope.organizationRole === "ADMIN";
    const subscription = mayReuseCustomer ? await tx.subscription.findUnique({ where: { organizationId: scope.organizationId }, select: { stripeCustomerId: true } }) : null;
    return { order: { ...order, checkoutRequestKey: key }, customerId: mayReuseCustomer && isRealStripeCustomerId(subscription?.stripeCustomerId) ? subscription!.stripeCustomerId : null };
  }, txOptions);
  const { order, customerId } = reserved;
  const session = order.stripeCheckoutSessionId
    ? await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId)
    : await stripe.checkout.sessions.create({
      mode: "payment", client_reference_id: order.id, customer: customerId ?? undefined,
      line_items: [{ price_data: { currency: order.quoteCurrency!, unit_amount: order.quoteAmountMinor!,
        product_data: { name: "Professional translation order" } }, quantity: 1 }],
      metadata: orderMetadata(order), payment_intent_data: { metadata: orderMetadata(order) },
      success_url: `${input.returnBaseUrl}/projekte/${input.projectId}/uebersetzungen/profis?checkout=returned`,
      cancel_url: `${input.returnBaseUrl}/projekte/${input.projectId}/uebersetzungen/profis?checkout=canceled`,
    }, { idempotencyKey: order.checkoutRequestKey! });
  // Stripe has already returned; bind it in a second, short transaction. The
  // webhook can independently bind the same session if this response is lost.
  const verified = await verifiedSession(stripe, order, session.id, false);
  if (verified.session.id !== session.id || !session.url || !session.url.startsWith("https://checkout.stripe.com/")) throw conflict();
  await db.$transaction(async (tx) => {
    const scope = await lockProfessionalOrderManagerScope(tx, input);
    const current = await tx.professionalTranslationOrder.findUniqueOrThrow({ where: { id: order.id } });
    assertProfessionalOrderOwner(scope, current.organizationId);
    assertProfessionalOrderLanguage(scope, current.sourceLanguage, current.targetLanguage);
    if (current.activeProjectId !== input.projectId || current.checkoutRequestKey !== order.checkoutRequestKey || current.status !== "PAYMENT_PENDING" ||
        (current.stripeCheckoutSessionId && current.stripeCheckoutSessionId !== session.id)) throw conflict();
    await tx.professionalTranslationOrder.update({ where: { id: order.id }, data: { stripeCheckoutSessionId: session.id } });
  }, txOptions);
  return { url: session.url };
}

/** Caller must verify the raw Stripe signature before passing the event. */
export async function applyProfessionalStripeEvent(event: Stripe.Event, stripe: ProfessionalOrderStripe) {
  requireProfessionalOrdersEnabled();
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.async_payment_failed") {
    const eventSession = event.data.object as Stripe.Checkout.Session;
    const orderId = eventSession.client_reference_id;
    if (!orderId) throw conflict();
    const order = await paymentOrder(orderId);
    if (!order) throw new ProfessionalOrderError("NOT_FOUND", "Order not found.");
    if (!order.checkoutRequestKey || !order.checkoutAttemptedAt) throw conflict("No durable Checkout attempt exists for this order.");
    const failed = event.type === "checkout.session.async_payment_failed";
    const latestSession = await stripe.checkout.sessions.retrieve(eventSession.id);
    const { session, intentId } = await verifiedSession(stripe, order, eventSession.id, !failed && latestSession.payment_status === "paid");
    if (!failed && session.payment_status !== "paid") return { status: order.status }; // delayed payment method
    if (failed && session.payment_status === "paid") throw conflict();
    return db.$transaction(async (tx) => {
      const current = await tx.professionalTranslationOrder.findUniqueOrThrow({ where: { id: order.id } });
      if (current.organizationId !== order.organizationId || current.projectId !== order.projectId ||
          current.quoteReference !== order.quoteReference || current.scopeDigest !== order.scopeDigest ||
          current.quoteAmountMinor !== order.quoteAmountMinor || current.quoteCurrency !== order.quoteCurrency ||
          (current.stripeCheckoutSessionId && current.stripeCheckoutSessionId !== session.id) ||
          (current.stripePaymentIntentId && current.stripePaymentIntentId !== intentId)) throw conflict();
      const paid = !failed;
      if (paid && current.paymentReference === intentId) return { status: current.status };
      if (failed && current.status !== "PAYMENT_PENDING") return { status: current.status };
      const next = paid ? (["CANCELED", "FAILED"].includes(current.status) ? "REFUND_PENDING" : "PAID") : "FAILED";
      if (paid && !["PAYMENT_PENDING", "CANCELED", "FAILED"].includes(current.status)) throw conflict();
      await tx.professionalTranslationOrder.update({ where: { id: order.id }, data: {
        status: next, stripeCheckoutSessionId: session.id, stripePaymentIntentId: intentId,
        ...(paid ? { paymentProvider: "stripe_checkout", paymentReference: intentId, paidAt: new Date() } : { failureCode: "payment_failed" }),
      } });
      await tx.professionalTranslationOrderEvent.create({ data: { orderId: order.id, kind: paid ? (next === "REFUND_PENDING" ? "late_payment_refund_required" : "payment_confirmed") : "payment_failed",
        actorType: "stripe_webhook", reference: event.id } });
      return { status: next };
    }, txOptions);
  }
  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    const disputeCharge = (event.data.object as Stripe.Dispute).charge;
    const chargeId = event.type === "charge.refunded"
      ? (event.data.object as Stripe.Charge).id
      : typeof disputeCharge === "string" ? disputeCharge : disputeCharge?.id;
    if (!chargeId) throw conflict();
    const charge = await stripe.charges.retrieve(chargeId);
    const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (!intentId) throw conflict();
    const order = await db.professionalTranslationOrder.findUnique({ where: { stripePaymentIntentId: intentId } });
    if (!order) throw new ProfessionalOrderError("NOT_FOUND", "Payment order not found.");
    if (!order.stripeCheckoutSessionId) throw conflict();
    await verifiedSession(stripe, order, order.stripeCheckoutSessionId, true);
    if (charge.id !== chargeId || charge.currency.toUpperCase() !== order.quoteCurrency || charge.amount !== order.quoteAmountMinor) throw conflict();
    if (event.type === "charge.refunded" && charge.amount_refunded !== order.quoteAmountMinor) return { status: order.status }; // partial: owner reconciliation
    if (event.type === "charge.dispute.created") {
      const dispute = await stripe.disputes.retrieve((event.data.object as Stripe.Dispute).id);
      const disputeChargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      if (dispute.id !== (event.data.object as Stripe.Dispute).id || disputeChargeId !== chargeId ||
          dispute.amount !== order.quoteAmountMinor || dispute.currency.toUpperCase() !== order.quoteCurrency) throw conflict();
    }
    return db.$transaction(async (tx) => {
      const current = await tx.professionalTranslationOrder.findUniqueOrThrow({ where: { id: order.id } });
      if (current.stripePaymentIntentId !== intentId || current.organizationId !== order.organizationId) throw conflict();
      const kind = event.type === "charge.refunded" ? "refund_confirmed" : "dispute_opened";
      if (await tx.professionalTranslationOrderEvent.findUnique({ where: { orderId_kind_reference: { orderId: order.id, kind, reference: event.id } } })) return { status: current.status };
      const next = kind === "refund_confirmed" ? "REFUNDED" : "DISPUTED";
      if (kind === "refund_confirmed" && !["PAID", "IN_PROGRESS", "DELIVERED", "REFUND_PENDING", "DISPUTED", "FAILED"].includes(current.status) ||
          kind === "dispute_opened" && !["PAID", "IN_PROGRESS", "DELIVERED", "REFUND_PENDING", "REFUNDED", "FAILED"].includes(current.status)) throw conflict();
      await tx.professionalTranslationOrder.update({ where: { id: order.id }, data: { status: next, ...(kind === "refund_confirmed" ? { refundReference: charge.id } : {}) } });
      await tx.professionalTranslationOrderEvent.create({ data: { orderId: order.id, kind, actorType: "stripe_webhook", reference: event.id } });
      if (kind === "dispute_opened") await tx.professionalTranslationVendorGrant.updateMany({ where: { orderId: order.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return { status: next };
    }, txOptions);
  }
  return { ignored: true };
}
