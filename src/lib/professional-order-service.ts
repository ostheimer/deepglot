import { randomBytes } from "node:crypto";
import { Prisma, type ProfessionalTranslationOrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { assertValidTranslationContent, stageAdoptedProfessionalDraftForReviewInTransaction, updateProjectTranslationContentInTransaction } from "@/lib/translation-workflow";
import { allPlaceholderQuality, savedVariableQuality } from "@/lib/translation-quality";
import { assertProfessionalOrderLanguage, assertProfessionalOrderOwner, lockProfessionalOrderManagerScope } from "@/lib/professional-order-access";
import {
  assertOrderTransition, assertQuote, countOrderWords, hashVendorToken,
  MAX_ORDER_SEGMENTS, MAX_VENDOR_TOKEN_DAYS, ProfessionalOrderError,
  quoteIsCurrent, requireProfessionalOrdersEnabled, scopeDigest,
  type OrderSnapshotItem,
} from "@/lib/professional-orders";

const txOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 15_000 } as const;

function changed() { return new ProfessionalOrderError("CONFLICT", "Order changed; reload and try again."); }

async function assertActiveVendorGrant(tx: Prisma.TransactionClient, orderId: string, grantId: string) {
  const grant = await tx.professionalTranslationVendorGrant.findFirst({ where: { id: grantId, orderId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
  if (!grant) throw new ProfessionalOrderError("FORBIDDEN", "Vendor access expired or was revoked.");
  const order = await tx.professionalTranslationOrder.findUnique({ where: { id: orderId }, select: { organizationId: true, projectId: true, project: { select: { id: true, organizationId: true } } } });
  if (!order?.organizationId || !order.project || order.project.id !== order.projectId || order.organizationId !== order.project.organizationId) throw new ProfessionalOrderError("FORBIDDEN", "Order ownership changed.");
}

export async function createProfessionalOrder(input: { projectId: string; requesterId: string; translationIds: string[]; targetLanguage: string }) {
  requireProfessionalOrdersEnabled();
  const ids = [...new Set(input.translationIds)];
  if (ids.length === 0 || ids.length > MAX_ORDER_SEGMENTS || ids.length !== input.translationIds.length) {
    throw new ProfessionalOrderError("INVALID", "Select between 1 and 100 distinct segments.");
  }
  return db.$transaction(async (tx) => {
    const scope = await lockProfessionalOrderManagerScope(tx, { projectId: input.projectId, actorId: input.requesterId });
    assertProfessionalOrderLanguage(scope, scope.sourceLanguage, input.targetLanguage);
    const translations = await tx.translation.findMany({
      where: { id: { in: ids }, projectId: input.projectId, langFrom: scope.sourceLanguage, langTo: input.targetLanguage },
      select: { id: true, originalHash: true, originalText: true, updatedAt: true },
    });
    if (translations.length !== ids.length) throw new ProfessionalOrderError("INVALID", "Segments must belong to the selected project and language.");
    const snapshots: OrderSnapshotItem[] = translations.map((item) => ({
      translationId: item.id, originalHash: item.originalHash, originalText: item.originalText, sourceUpdatedAt: item.updatedAt,
    }));
    const wordCount = snapshots.reduce((sum, item) => sum + countOrderWords(item.originalText), 0);
    if (!Number.isSafeInteger(wordCount) || wordCount === 0) throw new ProfessionalOrderError("INVALID", "Scope has no translatable words.");
    return tx.professionalTranslationOrder.create({
      data: {
        projectId: input.projectId, activeProjectId: input.projectId, organizationId: scope.organizationId, requesterId: input.requesterId,
        sourceLanguage: scope.sourceLanguage, targetLanguage: input.targetLanguage,
        scopeDigest: scopeDigest(snapshots, scope.sourceLanguage, input.targetLanguage), wordCount,
        items: { create: snapshots.map((item) => ({ translationId: item.translationId, originalHash: item.originalHash, originalText: item.originalText, sourceUpdatedAt: item.sourceUpdatedAt })) },
        events: { create: { kind: "quote_requested", actorType: "manager", actorId: input.requesterId } },
      },
      select: { id: true, status: true, scopeDigest: true, wordCount: true, createdAt: true },
    });
  }, txOptions);
}

export async function issueVendorGrant(input: { orderId: string; projectId: string; actorId: string }) {
  requireProfessionalOrdersEnabled();
  const token = `dgpo_${randomBytes(32).toString("hex")}`;
  const expiresAt = new Date(Date.now() + MAX_VENDOR_TOKEN_DAYS * 86_400_000);
  await db.$transaction(async (tx) => {
    const scope = await lockProfessionalOrderManagerScope(tx, { projectId: input.projectId, actorId: input.actorId });
    const order = await tx.professionalTranslationOrder.findFirst({ where: { id: input.orderId, projectId: input.projectId, activeProjectId: input.projectId }, select: { status: true, organizationId: true, sourceLanguage: true, targetLanguage: true } });
    if (!order) throw new ProfessionalOrderError("NOT_FOUND", "Order not found.");
    assertProfessionalOrderOwner(scope, order.organizationId);
    assertProfessionalOrderLanguage(scope, order.sourceLanguage, order.targetLanguage);
    if (order.status !== "QUOTE_REQUESTED") throw changed();
    await tx.professionalTranslationVendorGrant.create({ data: { orderId: input.orderId, tokenHash: hashVendorToken(token), expiresAt } });
    await tx.professionalTranslationOrderEvent.create({ data: { orderId: input.orderId, kind: "vendor_grant_issued", actorType: "manager", actorId: input.actorId } });
  }, txOptions);
  return { token, expiresAt };
}

export async function vendorQuote(input: { orderId: string; amountMinor: number; currency: string; turnaroundDays: number; expiresAt: Date; reference: string; termsVersion: string; vendorGrantId: string }) {
  requireProfessionalOrdersEnabled();
  assertQuote(input.amountMinor, input.currency, input.turnaroundDays, input.expiresAt);
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(input.reference) || !/^[A-Za-z0-9._:-]{1,80}$/.test(input.termsVersion)) throw new ProfessionalOrderError("INVALID", "Invalid quote reference or terms version.");
  return db.$transaction(async (tx) => {
    await assertActiveVendorGrant(tx, input.orderId, input.vendorGrantId);
    const updated = await tx.professionalTranslationOrder.updateMany({
      where: { id: input.orderId, status: "QUOTE_REQUESTED" },
      data: { status: "QUOTED", quoteAmountMinor: input.amountMinor, quoteCurrency: input.currency, quoteTurnaroundDays: input.turnaroundDays, quoteExpiresAt: input.expiresAt, quoteReference: input.reference, quoteTermsVersion: input.termsVersion, selectedVendorGrantId: input.vendorGrantId },
    });
    if (updated.count !== 1) throw changed();
    await tx.professionalTranslationVendorGrant.updateMany({ where: { orderId: input.orderId, id: { not: input.vendorGrantId }, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.professionalTranslationOrderEvent.create({ data: { orderId: input.orderId, kind: "quoted", actorType: "vendor_grant", actorId: input.vendorGrantId, reference: input.reference } });
    return tx.professionalTranslationOrder.findUniqueOrThrow({ where: { id: input.orderId }, select: { id: true, status: true, quoteAmountMinor: true, quoteCurrency: true, quoteTurnaroundDays: true, quoteExpiresAt: true, quoteTermsVersion: true } });
  }, txOptions);
}

export async function acceptProfessionalQuote(input: { orderId: string; projectId: string; actorId: string; expectedScopeDigest: string; expectedQuoteReference: string }) {
  requireProfessionalOrdersEnabled();
  await expireProfessionalQuotes(input.projectId, input.actorId);
  return db.$transaction(async (tx) => {
    const scope = await lockProfessionalOrderManagerScope(tx, { projectId: input.projectId, actorId: input.actorId });
    const order = await tx.professionalTranslationOrder.findFirst({ where: { id: input.orderId, projectId: input.projectId, activeProjectId: input.projectId }, select: { status: true, organizationId: true, sourceLanguage: true, targetLanguage: true, quoteExpiresAt: true, scopeDigest: true, quoteReference: true, items: { select: { translationId: true, originalHash: true, sourceUpdatedAt: true } } } });
    if (!order) throw new ProfessionalOrderError("NOT_FOUND", "Order not found.");
    assertProfessionalOrderOwner(scope, order.organizationId);
    assertProfessionalOrderLanguage(scope, order.sourceLanguage, order.targetLanguage);
    if (order.scopeDigest !== input.expectedScopeDigest || order.quoteReference !== input.expectedQuoteReference) throw changed();
    if (!quoteIsCurrent(order.status, order.quoteExpiresAt)) {
      throw new ProfessionalOrderError("CONFLICT", "Quote expired or is no longer available.");
    }
    const current = await tx.translation.findMany({ where: { id: { in: order.items.map((item) => item.translationId) }, projectId: input.projectId }, select: { id: true, originalHash: true, updatedAt: true } });
    if (current.length !== order.items.length || order.items.some((item) => !current.some((translation) => translation.id === item.translationId && translation.originalHash === item.originalHash && translation.updatedAt.getTime() === item.sourceUpdatedAt.getTime()))) {
      throw new ProfessionalOrderError("CONFLICT", "Order scope changed after the quote; request a new quote.");
    }
    const updated = await tx.professionalTranslationOrder.updateMany({ where: { id: input.orderId, status: "QUOTED", scopeDigest: input.expectedScopeDigest, quoteReference: input.expectedQuoteReference, quoteExpiresAt: { gt: new Date() } }, data: { status: "PAYMENT_PENDING" } });
    if (updated.count !== 1) throw changed();
    await tx.professionalTranslationOrderEvent.create({ data: { orderId: input.orderId, kind: "quote_accepted", actorType: "manager", actorId: input.actorId } });
    return { status: "PAYMENT_PENDING" as const };
  }, txOptions);
}

export async function expireProfessionalQuotes(projectId: string, actorId: string) {
  requireProfessionalOrdersEnabled();
  return db.$transaction(async (tx) => {
    const scope = await lockProfessionalOrderManagerScope(tx, { projectId, actorId });
    return tx.professionalTranslationOrder.updateMany({ where: { projectId, activeProjectId: projectId, organizationId: scope.organizationId, status: "QUOTED", quoteExpiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
  }, txOptions);
}

// Called only by a verified payment adapter. A redirect/success URL is never payment proof.
export async function recordProfessionalPayment(input: { orderId: string; provider: string; reference: string; amountMinor: number; currency: string; paid: boolean }) {
  requireProfessionalOrdersEnabled();
  if (!/^[a-z0-9_-]{2,40}$/.test(input.provider) || !/^[A-Za-z0-9._:-]{1,150}$/.test(input.reference)) throw new ProfessionalOrderError("INVALID", "Invalid payment reference.");
  return db.$transaction(async (tx) => {
    const order = await tx.professionalTranslationOrder.findUnique({ where: { id: input.orderId }, select: { status: true, paymentReference: true, paidAt: true, quoteAmountMinor: true, quoteCurrency: true } });
    if (!order) throw new ProfessionalOrderError("NOT_FOUND", "Order not found.");
    if (order.quoteAmountMinor !== input.amountMinor || order.quoteCurrency !== input.currency) throw new ProfessionalOrderError("CONFLICT", "Payment amount or currency does not match the accepted quote.");
    if (order.paymentReference === input.reference && (input.paid ? order.paidAt !== null : order.status === "FAILED")) return { status: order.status };
    if (order.status === "CANCELED") {
      if (!input.paid) return { status: "CANCELED" as const };
      const late = await tx.professionalTranslationOrder.updateMany({ where: { id: input.orderId, status: "CANCELED", paymentReference: null }, data: { status: "REFUND_PENDING", paymentProvider: input.provider, paymentReference: input.reference, paidAt: new Date() } });
      if (late.count !== 1) throw changed();
      await tx.professionalTranslationOrderEvent.create({ data: { orderId: input.orderId, kind: "late_payment_refund_required", actorType: "payment_adapter", reference: input.reference } });
      return { status: "REFUND_PENDING" as const };
    }
    assertOrderTransition(order.status, input.paid ? "PAID" : "FAILED");
    const updated = await tx.professionalTranslationOrder.updateMany({ where: { id: input.orderId, status: "PAYMENT_PENDING", paymentReference: null }, data: { status: input.paid ? "PAID" : "FAILED", paymentProvider: input.provider, paymentReference: input.reference, ...(input.paid ? { paidAt: new Date() } : { failureCode: "payment_failed" }) } });
    if (updated.count !== 1) throw changed();
    await tx.professionalTranslationOrderEvent.create({ data: { orderId: input.orderId, kind: input.paid ? "payment_confirmed" : "payment_failed", actorType: "payment_adapter", reference: input.reference } });
    return { status: input.paid ? "PAID" as const : "FAILED" as const };
  }, txOptions);
}

// Payment/refund/dispute adapters must authenticate and normalize provider
// events before calling this. The reference is unique for replay protection.
export async function recordProfessionalSettlement(input: { orderId: string; kind: "refund_confirmed" | "dispute_opened" | "fulfillment_failed"; reference: string }) {
  requireProfessionalOrdersEnabled();
  if (!/^[A-Za-z0-9._:-]{1,150}$/.test(input.reference)) throw new ProfessionalOrderError("INVALID", "Invalid settlement reference.");
  return db.$transaction(async (tx) => {
    const order = await tx.professionalTranslationOrder.findUnique({ where: { id: input.orderId }, select: { status: true, refundReference: true } });
    if (!order) throw new ProfessionalOrderError("NOT_FOUND", "Order not found.");
    const next: ProfessionalTranslationOrderStatus = input.kind === "refund_confirmed" ? "REFUNDED" : input.kind === "dispute_opened" ? "DISPUTED" : "FAILED";
    const previousEvent = await tx.professionalTranslationOrderEvent.findUnique({ where: { orderId_kind_reference: { orderId: input.orderId, kind: input.kind, reference: input.reference } } });
    if (previousEvent) return { status: order.status };
    assertOrderTransition(order.status, next);
    const updated = await tx.professionalTranslationOrder.updateMany({ where: { id: input.orderId, status: order.status }, data: { status: next, ...(next === "REFUNDED" ? { refundReference: input.reference } : {}), ...(next === "FAILED" ? { failureCode: "fulfillment_failed" } : {}) } });
    if (updated.count !== 1) throw changed();
    await tx.professionalTranslationOrderEvent.create({ data: { orderId: input.orderId, kind: input.kind, actorType: "payment_or_fulfillment_adapter", reference: input.reference } });
    if (next !== "REFUNDED") await tx.professionalTranslationVendorGrant.updateMany({ where: { orderId: input.orderId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { status: next };
  }, txOptions);
}

export async function deliverProfessionalOrder(input: { orderId: string; vendorGrantId: string; items: { itemId: string; proposedText: string }[] }) {
  requireProfessionalOrdersEnabled();
  if (input.items.length === 0 || input.items.length > MAX_ORDER_SEGMENTS || new Set(input.items.map((item) => item.itemId)).size !== input.items.length) throw new ProfessionalOrderError("INVALID", "Invalid delivery scope.");
  for (const item of input.items) assertValidTranslationContent(item.proposedText);
  return db.$transaction(async (tx) => {
    await assertActiveVendorGrant(tx, input.orderId, input.vendorGrantId);
    const order = await tx.professionalTranslationOrder.findUnique({ where: { id: input.orderId }, include: { items: { select: { id: true, translationId: true, originalText: true, proposedText: true } } } });
    if (!order || !["PAID", "IN_PROGRESS"].includes(order.status) || order.selectedVendorGrantId !== input.vendorGrantId) throw changed();
    if (order.items.length !== input.items.length || order.items.some((item) => !input.items.some((given) => given.itemId === item.id && item.proposedText === null))) throw new ProfessionalOrderError("INVALID", "Delivery must include every scoped item exactly once.");
    const metadata = await tx.translationMetadata.findMany({ where: { translationId: { in: order.items.map((item) => item.translationId) } }, select: { translationId: true, variables: true } });
    const variables = new Map(metadata.map((row) => [row.translationId, row.variables]));
    for (const item of input.items) {
      const snapshot = order.items.find((row) => row.id === item.itemId);
      if (!snapshot || allPlaceholderQuality(snapshot.originalText, item.proposedText) === "mismatch" ||
          savedVariableQuality(snapshot.originalText, item.proposedText, variables.get(snapshot.translationId) ?? []) === "mismatch") {
        throw new ProfessionalOrderError("INVALID", "Delivered text must preserve the scoped placeholders and saved variables.");
      }
      const updated = await tx.professionalTranslationOrderItem.updateMany({ where: { id: item.itemId, orderId: input.orderId, proposedText: null }, data: { proposedText: item.proposedText, deliveredAt: new Date() } });
      if (updated.count !== 1) throw changed();
    }
    const updated = await tx.professionalTranslationOrder.updateMany({ where: { id: input.orderId, status: order.status }, data: { status: "DELIVERED" } });
    if (updated.count !== 1) throw changed();
    await tx.professionalTranslationVendorGrant.updateMany({ where: { orderId: input.orderId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.professionalTranslationOrderEvent.create({ data: { orderId: input.orderId, kind: "delivered", actorType: "vendor_grant", actorId: input.vendorGrantId } });
    return { status: "DELIVERED" as const };
  }, txOptions);
}

export async function startProfessionalOrder(input: { orderId: string; vendorGrantId: string }) {
  requireProfessionalOrdersEnabled();
  return db.$transaction(async (tx) => {
    await assertActiveVendorGrant(tx, input.orderId, input.vendorGrantId);
    const updated = await tx.professionalTranslationOrder.updateMany({ where: { id: input.orderId, status: "PAID", selectedVendorGrantId: input.vendorGrantId }, data: { status: "IN_PROGRESS" } });
    if (updated.count !== 1) throw changed();
    await tx.professionalTranslationOrderEvent.create({ data: { orderId: input.orderId, kind: "work_started", actorType: "vendor_grant", actorId: input.vendorGrantId } });
    return { status: "IN_PROGRESS" as const };
  }, txOptions);
}

export async function adoptProfessionalDelivery(input: { orderId: string; projectId: string; itemId: string; actorId: string; expectedUpdatedAt: Date }) {
  requireProfessionalOrdersEnabled();
  return db.$transaction(async (tx) => {
    const scope = await lockProfessionalOrderManagerScope(tx, { projectId: input.projectId, actorId: input.actorId });
    const order = await tx.professionalTranslationOrder.findFirst({ where: { id: input.orderId, projectId: input.projectId, activeProjectId: input.projectId, status: "DELIVERED" }, select: { organizationId: true, sourceLanguage: true, targetLanguage: true } });
    if (!order) throw changed();
    assertProfessionalOrderOwner(scope, order.organizationId);
    assertProfessionalOrderLanguage(scope, order.sourceLanguage, order.targetLanguage);
    const item = await tx.professionalTranslationOrderItem.findFirst({
      where: { id: input.itemId, orderId: input.orderId, order: { projectId: input.projectId, activeProjectId: input.projectId, status: "DELIVERED" }, proposedText: { not: null }, adoptedAt: null },
      select: { translationId: true, proposedText: true, originalHash: true, originalText: true, sourceUpdatedAt: true },
    });
    if (!item || !item.proposedText) throw changed();
    const translation = await tx.translation.findFirst({
      where: { id: item.translationId, projectId: input.projectId },
      select: { id: true, originalHash: true, originalText: true, langFrom: true, langTo: true, updatedAt: true, metadata: { select: { variables: true } } },
    });
    if (!translation || translation.originalHash !== item.originalHash || translation.updatedAt.getTime() !== input.expectedUpdatedAt.getTime() || item.sourceUpdatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw changed();
    if (allPlaceholderQuality(item.originalText, item.proposedText) === "mismatch" ||
        savedVariableQuality(item.originalText, item.proposedText, translation.metadata?.variables ?? []) === "mismatch") {
      throw new ProfessionalOrderError("CONFLICT", "Delivered text no longer meets placeholder or variable checks.");
    }
    const saved = await updateProjectTranslationContentInTransaction(tx, {
      projectId: input.projectId, translationId: translation.id, actorUserId: input.actorId,
      actor: { canManage: true, projectMemberId: null, langCode: null },
      translatedText: item.proposedText, expectedUpdatedAt: input.expectedUpdatedAt,
    });
    await stageAdoptedProfessionalDraftForReviewInTransaction(tx, {
      projectId: input.projectId, translationId: translation.id, actorUserId: input.actorId,
      langTo: translation.langTo, expectedUpdatedAt: saved.updatedAt,
    });
    const adoption = await tx.professionalTranslationOrderItem.updateMany({ where: { id: input.itemId, orderId: input.orderId, adoptedAt: null }, data: { adoptedAt: new Date(), adoptedById: input.actorId } });
    if (adoption.count !== 1) throw changed();
    await tx.professionalTranslationOrderEvent.create({ data: { orderId: input.orderId, kind: "delivery_adopted", actorType: "manager", actorId: input.actorId, reference: input.itemId } });
    return { adopted: true };
  }, txOptions);
}

/** Explicitly close paid, fully adopted and approved work. Financial evidence
 * remains with the originating merchant and can still receive later callbacks. */
export async function completeProfessionalOrder(input: { orderId: string; projectId: string; actorId: string }) {
  requireProfessionalOrdersEnabled();
  return db.$transaction(async (tx) => {
    const scope = await lockProfessionalOrderManagerScope(tx, { projectId: input.projectId, actorId: input.actorId });
    const order = await tx.professionalTranslationOrder.findFirst({
      where: { id: input.orderId, projectId: input.projectId, activeProjectId: input.projectId },
      include: { items: { select: { translationId: true, originalHash: true, proposedText: true, adoptedAt: true } } },
    });
    if (!order) throw new ProfessionalOrderError("NOT_FOUND", "Order not found.");
    assertProfessionalOrderOwner(scope, order.organizationId);
    assertProfessionalOrderLanguage(scope, order.sourceLanguage, order.targetLanguage);
    if (order.status !== "DELIVERED" || !order.checkoutRequestKey || !order.checkoutAttemptedAt ||
      !order.stripeCheckoutSessionId || !order.stripePaymentIntentId ||
      order.paymentProvider !== "stripe" || order.paymentReference !== order.stripePaymentIntentId ||
      !order.paidAt || !order.quoteAmountMinor || !order.quoteCurrency ||
      order.items.length === 0 || order.items.some((item) => !item.adoptedAt || !item.proposedText)) throw changed();
    const ids = order.items.map((item) => item.translationId).sort();
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Translation" WHERE "projectId" = ${input.projectId}
      AND "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR SHARE
    `);
    if (locked.length !== ids.length) throw changed();
    const translations = await tx.translation.findMany({ where: { projectId: input.projectId, id: { in: ids } },
      select: { id: true, originalHash: true, translatedText: true, workflowStatus: true, langFrom: true, langTo: true } });
    if (translations.length !== order.items.length || order.items.some((item) => !translations.some((translation) =>
      translation.id === item.translationId && translation.originalHash === item.originalHash &&
      translation.langFrom === order.sourceLanguage && translation.langTo === order.targetLanguage &&
      translation.translatedText === item.proposedText && translation.workflowStatus === "APPROVED"))) throw changed();
    const completed = await tx.professionalTranslationOrder.updateMany({
      where: { id: input.orderId, status: "DELIVERED", activeProjectId: input.projectId },
      data: { status: "COMPLETED", completedAt: new Date(), completedById: input.actorId },
    });
    if (completed.count !== 1) throw changed();
    await tx.professionalTranslationOrderEvent.create({ data: { orderId: input.orderId,
      kind: "fulfillment_completed", actorType: "manager", actorId: input.actorId } });
    return { status: "COMPLETED" as const };
  }, txOptions);
}

export async function cancelProfessionalOrder(input: { orderId: string; projectId: string; actorId: string }) {
  requireProfessionalOrdersEnabled();
  return db.$transaction(async (tx) => {
    const scope = await lockProfessionalOrderManagerScope(tx, { projectId: input.projectId, actorId: input.actorId });
    const order = await tx.professionalTranslationOrder.findFirst({ where: { id: input.orderId, projectId: input.projectId, activeProjectId: input.projectId }, select: { status: true, organizationId: true, sourceLanguage: true, targetLanguage: true } });
    if (!order) throw new ProfessionalOrderError("NOT_FOUND", "Order not found.");
    assertProfessionalOrderOwner(scope, order.organizationId);
    assertProfessionalOrderLanguage(scope, order.sourceLanguage, order.targetLanguage);
    const next: ProfessionalTranslationOrderStatus = ["QUOTE_REQUESTED", "QUOTED", "PAYMENT_PENDING"].includes(order.status) ? "CANCELED" : "REFUND_PENDING";
    assertOrderTransition(order.status, next);
    const updated = await tx.professionalTranslationOrder.updateMany({ where: { id: input.orderId, status: order.status }, data: { status: next, ...(next === "CANCELED" ? { canceledAt: new Date() } : {}) } });
    if (updated.count !== 1) throw changed();
    await tx.professionalTranslationVendorGrant.updateMany({ where: { orderId: input.orderId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.professionalTranslationOrderEvent.create({ data: { orderId: input.orderId, kind: next === "CANCELED" ? "canceled" : "refund_requested", actorType: "manager", actorId: input.actorId } });
    return { status: next };
  }, txOptions);
}
