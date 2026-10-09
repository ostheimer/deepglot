export type UpgradeInvoiceAttempt = { stripeSubscriptionId: string; stripeInvoiceId: string | null; toPriceId: string };
export type UpgradeRemoteSubscription = { id: string; customer: string; status: string; priceId: string | null; latestInvoiceId: string | null; pendingUpdate: boolean };
export type UpgradeInvoiceProof = { id: string; customer: string | null; subscriptionId: string | null; status: string | null; billingReason: string | null; priceIds: string[] };

/** A delayed renewal invoice is never evidence of this exact upgrade. */
export function paidInvoiceMatchesAttempt(attempt: UpgradeInvoiceAttempt, expectedCustomerId: string,
  remote: UpgradeRemoteSubscription, invoice: UpgradeInvoiceProof): boolean {
  return Boolean(attempt.stripeInvoiceId && attempt.stripeInvoiceId === invoice.id &&
    remote.id === attempt.stripeSubscriptionId && remote.customer === expectedCustomerId && remote.status === "active" &&
    remote.priceId === attempt.toPriceId && remote.latestInvoiceId === invoice.id && !remote.pendingUpdate &&
    invoice.customer === expectedCustomerId && invoice.subscriptionId === attempt.stripeSubscriptionId &&
    invoice.status === "paid" && invoice.billingReason === "subscription_update" &&
    invoice.priceIds.includes(attempt.toPriceId));
}

/** Do not mask a genuine failed renewal when the upgrade invoice has not been bound. */
export function failedInvoiceIsUpgradeInvoice(attempt: UpgradeInvoiceAttempt, invoiceId: string): boolean {
  return Boolean(attempt.stripeInvoiceId && attempt.stripeInvoiceId === invoiceId);
}
