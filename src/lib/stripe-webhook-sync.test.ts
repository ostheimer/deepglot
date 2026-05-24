import test from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type Stripe from "stripe";

const globalForPrisma = globalThis as unknown as {
  prisma?: unknown;
};

test("syncs the organization plan when Stripe updates an existing subscription", async (t) => {
  const originalPrisma = globalForPrisma.prisma;
  const originalStripeSecret = process.env.STRIPE_SECRET_KEY;
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const originalPriceId = process.env.STRIPE_PRICE_PRO_MONTHLY;

  const subscriptionUpdate = t.mock.fn(async () => ({
    organizationId: "org_123",
  }));
  const organizationUpdate = t.mock.fn(async () => ({}));

  globalForPrisma.prisma = {
    subscription: {
      update: subscriptionUpdate,
    },
    organization: {
      update: organizationUpdate,
    },
  };

  process.env.STRIPE_SECRET_KEY = "sk_test_deepglot";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_deepglot";
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_monthly";

  t.after(() => {
    globalForPrisma.prisma = originalPrisma;
    restoreEnv("STRIPE_SECRET_KEY", originalStripeSecret);
    restoreEnv("STRIPE_WEBHOOK_SECRET", originalWebhookSecret);
    restoreEnv("STRIPE_PRICE_PRO_MONTHLY", originalPriceId);
  });

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

function restoreEnv(key: string, value: string | undefined) {
  if (typeof value === "undefined") {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
