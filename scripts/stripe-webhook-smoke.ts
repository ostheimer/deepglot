#!/usr/bin/env -S node --import tsx
/**
 * ROADMAP 7.15 — Stripe webhook end-to-end smoke for subscription-lifecycle
 * events. Sends locally signed `customer.subscription.updated`,
 * `invoice.payment_failed`, and `customer.subscription.deleted` events to a
 * running Deepglot instance and asserts the database writes the handlers are
 * responsible for, including the FREE soft-cap from getEffectiveWordsLimit()
 * for non-ACTIVE/TRIALING statuses (the verification gap behind PR #37's
 * grace-period policy).
 *
 * The events are signed with STRIPE_WEBHOOK_SECRET via the official
 * stripe-node test helper, so no Stripe account round-trip is needed — the
 * target app just has to share the same webhook secret (test mode).
 *
 * Deliberately explicit targeting: the script refuses to run without
 * DEEPGLOT_WEBHOOK_SMOKE_BASE_URL, so it can never accidentally point at
 * production. Run it against a local dev server + the Neon preview branch:
 *
 *   DEEPGLOT_WEBHOOK_SMOKE_BASE_URL=http://127.0.0.1:3000 \
 *   npm run smoke:stripe-webhooks
 *
 * The disposable organization + subscription created for the drill are
 * removed in a finally block.
 */

import { existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";
import Stripe from "stripe";

const envFiles = [".env.development.local", ".env.local", ".env"];
for (const file of envFiles) {
  if (existsSync(file)) {
    const values = dotenv.parse(readFileSync(file));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined && value.trim() !== "") {
        process.env[key] = value;
      }
    }
  }
}

const baseUrl = process.env.DEEPGLOT_WEBHOOK_SMOKE_BASE_URL?.trim();
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

function blocked(reason: string): never {
  console.error(`BLOCKED Stripe webhook smoke: ${reason}`);
  process.exit(1);
}

if (!baseUrl) {
  blocked(
    "DEEPGLOT_WEBHOOK_SMOKE_BASE_URL is required (explicit target only — e.g. http://127.0.0.1:3000; never point this at production)."
  );
}
if (!webhookSecret) {
  blocked("STRIPE_WEBHOOK_SECRET is required and must match the target app.");
}
if (!process.env.DATABASE_URL && !process.env.DEEPGLOT_DATABASE_URL) {
  blocked("DATABASE_URL (or DEEPGLOT_DATABASE_URL) must point at the target app's database.");
}
if (process.env.DEEPGLOT_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DEEPGLOT_DATABASE_URL;
}

const webhookUrl = new URL("/api/webhooks/stripe", baseUrl).toString();
const runId = `smoke${process.pid}${Math.trunc(performance.now() * 1000)}`;
const stripeSubscriptionId = `sub_${runId}`;

type CheckResult = { name: string; ok: boolean; detail: string };
const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
}

async function postSignedEvent(type: string, object: Record<string, unknown>) {
  const payload = JSON.stringify({
    id: `evt_${runId}_${type.replace(/\W/g, "")}`,
    object: "event",
    api_version: "2026-02-25.clover",
    type,
    data: { object },
  });

  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret!,
  });

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body: payload,
    signal: AbortSignal.timeout(20_000),
  });

  return response;
}

function subscriptionObject(overrides: {
  status: Stripe.Subscription.Status;
  priceId?: string;
  periodEnd?: number;
}) {
  return {
    id: stripeSubscriptionId,
    object: "subscription",
    status: overrides.status,
    items: {
      object: "list",
      data: [
        {
          object: "subscription_item",
          price: { id: overrides.priceId ?? "price_smoke_unknown", object: "price" },
          current_period_end: overrides.periodEnd ?? Math.trunc(Date.now() / 1000) + 30 * 86_400,
        },
      ],
    },
  };
}

async function main() {
  const { db } = await import("@/lib/db");
  const { BILLING_PLANS, getEffectiveWordsLimit } = await import("@/lib/billing-plans");

  const proPriceId = process.env.STRIPE_PRICE_PRO_MONTHLY?.trim();

  console.log(`Deepglot Stripe webhook smoke (${new Date().toISOString()})`);
  console.log(`Target: ${webhookUrl}`);
  console.log(`Disposable subscription: ${stripeSubscriptionId}`);

  // Seed a disposable org + STARTER subscription (STARTER exists in both the current schema and the older preview-DB Plan enum) the handlers can act on.
  const organization = await db.organization.create({
    data: {
      name: `Webhook Smoke ${runId}`,
      slug: `webhook-${runId.toLowerCase()}`,
      plan: "STARTER",
      subscription: {
        create: {
          stripeCustomerId: `cus_${runId}`,
          stripeSubscriptionId,
          status: "ACTIVE",
          plan: "STARTER",
          wordsLimit: BILLING_PLANS.STARTER.wordsLimit,
        },
      },
    },
    select: { id: true },
  });

  try {
    // 0. Signature gate: a tampered payload must be rejected with 400.
    const badSignature = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=bad" },
      body: JSON.stringify({ type: "customer.subscription.updated" }),
      signal: AbortSignal.timeout(20_000),
    });
    record(
      "Signature verification",
      badSignature.status === 400,
      `tampered signature -> ${badSignature.status} (expected 400)`
    );

    // 1. customer.subscription.updated with the PRO price (when configured).
    if (proPriceId) {
      const response = await postSignedEvent(
        "customer.subscription.updated",
        subscriptionObject({ status: "active", priceId: proPriceId })
      );
      const row = await db.subscription.findUnique({ where: { stripeSubscriptionId } });
      record(
        "subscription.updated -> plan/wordsLimit",
        response.status === 200 &&
          row?.plan === "PRO" &&
          row?.wordsLimit === BILLING_PLANS.PRO.wordsLimit &&
          row?.status === "ACTIVE" &&
          row?.stripeCurrentPeriodEnd !== null,
        `http=${response.status}; plan=${row?.plan}; wordsLimit=${row?.wordsLimit}; status=${row?.status}`
      );
    } else {
      const response = await postSignedEvent(
        "customer.subscription.updated",
        subscriptionObject({ status: "active" })
      );
      const row = await db.subscription.findUnique({ where: { stripeSubscriptionId } });
      record(
        "subscription.updated -> status only (no STRIPE_PRICE_PRO_MONTHLY configured)",
        response.status === 200 && row?.status === "ACTIVE" && row?.plan === "STARTER",
        `http=${response.status}; plan kept=${row?.plan}; status=${row?.status} (unknown price id keeps the plan)`
      );
    }

    // 2. invoice.payment_failed -> PAST_DUE + FREE soft-cap.
    const failedResponse = await postSignedEvent("invoice.payment_failed", {
      id: `in_${runId}`,
      object: "invoice",
      parent: { subscription_details: { subscription: stripeSubscriptionId } },
    });
    const pastDueRow = await db.subscription.findUnique({ where: { stripeSubscriptionId } });
    record(
      "invoice.payment_failed -> PAST_DUE",
      failedResponse.status === 200 && pastDueRow?.status === "PAST_DUE",
      `http=${failedResponse.status}; status=${pastDueRow?.status}`
    );
    record(
      "PAST_DUE soft-caps to the FREE words limit",
      pastDueRow !== null &&
        getEffectiveWordsLimit(pastDueRow) === BILLING_PLANS.FREE.wordsLimit &&
        pastDueRow.wordsLimit > BILLING_PLANS.FREE.wordsLimit,
      `stored wordsLimit=${pastDueRow?.wordsLimit}; effective=${pastDueRow ? getEffectiveWordsLimit(pastDueRow) : "n/a"} (FREE=${BILLING_PLANS.FREE.wordsLimit})`
    );

    // 3. customer.subscription.deleted -> CANCELED + FREE on sub AND org.
    const deletedResponse = await postSignedEvent(
      "customer.subscription.deleted",
      subscriptionObject({ status: "canceled" })
    );
    const canceledRow = await db.subscription.findUnique({ where: { stripeSubscriptionId } });
    const orgRow = await db.organization.findUnique({
      where: { id: organization.id },
      select: { plan: true },
    });
    record(
      "subscription.deleted -> CANCELED + FREE",
      deletedResponse.status === 200 &&
        canceledRow?.status === "CANCELED" &&
        canceledRow?.plan === "FREE" &&
        orgRow?.plan === "FREE",
      `http=${deletedResponse.status}; sub=${canceledRow?.status}/${canceledRow?.plan}; org=${orgRow?.plan}`
    );
  } finally {
    await db.organization.delete({ where: { id: organization.id } }).catch((error) => {
      console.error(`Cleanup failed for org ${organization.id}: ${error}`);
    });
    await db.$disconnect();
  }

  const failed = results.filter((result) => !result.ok).length;
  console.log(`Summary: ${results.length - failed}/${results.length} passed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`Stripe webhook smoke failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
