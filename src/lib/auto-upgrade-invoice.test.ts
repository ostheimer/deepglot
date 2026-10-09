import assert from "node:assert/strict";
import test from "node:test";
import { paidInvoiceMatchesAttempt, failedInvoiceIsUpgradeInvoice } from "./auto-upgrade-invoice";

const attempt = { stripeSubscriptionId: "sub_1", stripeInvoiceId: "in_upgrade", toPriceId: "price_business" };
const remote = { id: "sub_1", customer: "cus_1", status: "active", priceId: "price_business", latestInvoiceId: "in_upgrade", pendingUpdate: false };
const paid = { id: "in_upgrade", customer: "cus_1", subscriptionId: "sub_1", status: "paid", billingReason: "subscription_update", priceIds: ["price_business"] };

test("only the exact bound upgrade invoice grants entitlement", () => {
  assert.equal(paidInvoiceMatchesAttempt(attempt, "cus_1", remote, paid), true);
  assert.equal(paidInvoiceMatchesAttempt({ ...attempt, stripeInvoiceId: null }, "cus_1", remote, paid), false);
  assert.equal(paidInvoiceMatchesAttempt(attempt, "cus_1", remote, { ...paid, id: "in_old" }), false);
  assert.equal(paidInvoiceMatchesAttempt(attempt, "cus_1", { ...remote, latestInvoiceId: "in_other" }, paid), false);
  assert.equal(paidInvoiceMatchesAttempt(attempt, "cus_1", remote, { ...paid, customer: "cus_other" }), false);
  assert.equal(paidInvoiceMatchesAttempt(attempt, "cus_1", remote, { ...paid, status: "open" }), false);
  assert.equal(paidInvoiceMatchesAttempt(attempt, "cus_1", remote, { ...paid, priceIds: ["price_starter"] }), false);
  assert.equal(paidInvoiceMatchesAttempt(attempt, "cus_1", { ...remote, status: "canceled" }, paid), false);
});

test("a delayed failed renewal invoice does not suppress normal past-due handling", () => {
  assert.equal(failedInvoiceIsUpgradeInvoice(attempt, "in_upgrade"), true);
  assert.equal(failedInvoiceIsUpgradeInvoice(attempt, "in_renewal"), false);
  assert.equal(failedInvoiceIsUpgradeInvoice({ ...attempt, stripeInvoiceId: null }, "in_renewal"), false);
});
