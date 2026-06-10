import test from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type Stripe from "stripe";

const globalForPrisma = globalThis as unknown as {
  prisma?: {
    subscription: {
      update: ReturnType<typeof test.mock.fn>;
      findUnique: ReturnType<typeof test.mock.fn>;
    };
    organization: { update: ReturnType<typeof test.mock.fn> };
  };
};

const subscriptionUpdate = test.mock.fn(
  async (_args: {
    where: { stripeSubscriptionId: string };
    data: Record<string, unknown>;
    select?: { organizationId: true; plan?: true };
  }) => ({
    organizationId: "org_123",
    plan: "PRO",
  })
);
// handleSubscriptionUpdated checks for a tracked row before updating, so
// untracked subscriptions (e.g. an orphaned duplicate) are ignored instead of
// throwing and forcing Stripe to retry the event.
const subscriptionFindUnique = test.mock.fn(
  async (_args: {
    where: { stripeSubscriptionId: string };
    select?: Record<string, true>;
  }): Promise<{ organizationId: string } | null> => ({
    organizationId: "org_123",
  })
);
const organizationUpdate = test.mock.fn(
  async (_args: { where: { id: string }; data: { plan: string } }) => ({})
);

globalForPrisma.prisma = {
  subscription: { update: subscriptionUpdate, findUnique: subscriptionFindUnique },
  organization: { update: organizationUpdate },
};

test.before(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_deepglot";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_deepglot";
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_monthly";
});

test.after(() => {
  subscriptionUpdate.mock.resetCalls();
  organizationUpdate.mock.resetCalls();
});

test("syncs the organization plan when Stripe updates an existing subscription", async (t) => {
  const { stripe } = await import("@/lib/stripe");
  t.mock.method(stripe.webhooks, "constructEvent", () => ({
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_123",
        status: "active",
        items: {
          data: [
            {
              current_period_end: 1_800_000_000,
              price: { id: "price_pro_monthly" },
            },
          ],
        },
      },
    },
  }) as Stripe.Event);

  const { POST } = await import("@/app/api/webhooks/stripe/route");
  const response = await POST(
    new Request("https://deepglot.test/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    }) as NextRequest
  );

  assert.equal(response.status, 200);
  assert.equal(subscriptionUpdate.mock.callCount(), 1);
  assert.equal(organizationUpdate.mock.callCount(), 1);
  assert.deepEqual(organizationUpdate.mock.calls[0].arguments[0], {
    where: { id: "org_123" },
    data: { plan: "PRO" },
  });
});

test("customer.subscription.updated keeps existing plan when Stripe price id is unknown", async (t) => {
  subscriptionUpdate.mock.resetCalls();
  organizationUpdate.mock.resetCalls();

  const { stripe } = await import("@/lib/stripe");
  t.mock.method(stripe.webhooks, "constructEvent", () => ({
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_123",
        status: "active",
        items: {
          data: [
            {
              current_period_end: 1_800_000_000,
              price: { id: "price_rotated_not_in_env" },
            },
          ],
        },
      },
    },
  }) as Stripe.Event);

  const { POST } = await import("@/app/api/webhooks/stripe/route");
  const response = await POST(
    new Request("https://deepglot.test/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    }) as NextRequest
  );

  assert.equal(response.status, 200);
  assert.equal(subscriptionUpdate.mock.callCount(), 1);
  assert.equal(organizationUpdate.mock.callCount(), 0);
  const updateData = subscriptionUpdate.mock.calls[0].arguments[0].data;
  assert.equal(updateData.plan, undefined);
  assert.equal(updateData.wordsLimit, undefined);
  assert.equal(updateData.status, "ACTIVE");
});

test("customer.subscription.updated for an untracked subscription is acknowledged and ignored", async (t) => {
  subscriptionUpdate.mock.resetCalls();
  organizationUpdate.mock.resetCalls();
  // No DB row for this subscription id — e.g. an orphaned duplicate that the
  // checkout webhook deliberately keeps out of the Subscription table.
  subscriptionFindUnique.mock.mockImplementationOnce(async () => null);

  const { stripe } = await import("@/lib/stripe");
  t.mock.method(stripe.webhooks, "constructEvent", () => ({
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_orphaned",
        status: "active",
        items: {
          data: [
            {
              current_period_end: 1_800_000_000,
              price: { id: "price_pro_monthly" },
            },
          ],
        },
      },
    },
  }) as Stripe.Event);

  const { POST } = await import("@/app/api/webhooks/stripe/route");
  const response = await POST(
    new Request("https://deepglot.test/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    }) as NextRequest
  );

  // 200 so Stripe does not retry; nothing in the DB is touched.
  assert.equal(response.status, 200);
  assert.equal(subscriptionUpdate.mock.callCount(), 0);
  assert.equal(organizationUpdate.mock.callCount(), 0);
});
