import assert from "node:assert/strict";
import test from "node:test";
import { chooseAutoUpgrade } from "./auto-upgrade-policy";

const base = { enabled: true, plan: "STARTER", maxPlan: "PRO", interval: "monthly" as const, maxPriceCents: 6900, usedWords: 22_500, status: "ACTIVE", customerId: "cus_test", subscriptionId: "sub_test", cancelAtPeriodEnd: false, hasPendingUpdate: false };

test("one measured threshold selects only the next affordable paid tier", () => {
  assert.deepEqual(chooseAutoUpgrade(base), { from: "STARTER", to: "BUSINESS", interval: "monthly", priceCents: 2500 });
});

test("opt-out, below threshold, ceiling and synthetic customers never upgrade", () => {
  for (const input of [
    { enabled: false }, { usedWords: 22_499 }, { maxPlan: "STARTER" },
    { maxPriceCents: 2499 }, { customerId: "free_org" },
    { status: "PAST_DUE" }, { cancelAtPeriodEnd: true }, { hasPendingUpdate: true },
    { plan: "EXTENDED" },
  ]) assert.equal(chooseAutoUpgrade({ ...base, ...input }), null);
});
