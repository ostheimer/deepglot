#!/usr/bin/env -S node --import tsx
/**
 * Idempotent Stripe setup helper. Creates one Product per paid billing plan
 * (Starter / Business / Pro / Advanced / Extended), a monthly and a yearly
 * recurring Price for each, and a Webhook Endpoint pointing at
 * `${appUrl}/api/webhooks/stripe` with the events the route already handles.
 *
 * Re-running the script never duplicates anything: products, prices and the
 * webhook endpoint are matched by metadata or URL and updated in place.
 *
 * Outputs a `.env` block with every STRIPE_PRICE_<TIER>_<INTERVAL> line plus
 * STRIPE_WEBHOOK_SECRET that the operator can paste into
 * `.env.production.local` (or push to Vercel).
 *
 * Usage:
 *   STRIPE_SECRET_KEY=rk_test_… node --import tsx scripts/stripe-setup.ts
 *   STRIPE_SECRET_KEY=rk_test_… node --import tsx scripts/stripe-setup.ts --mode live
 */

import { existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";
import type Stripe from "stripe";

const args = process.argv.slice(2);
const modeIndex = args.indexOf("--mode");
const mode: "test" | "live" =
  modeIndex >= 0 && args[modeIndex + 1] === "live" ? "live" : "test";
const appUrlOverride = (() => {
  const i = args.indexOf("--app-url");
  return i >= 0 ? args[i + 1] : undefined;
})();

const envFiles = [".env.production.local", ".env.local"];
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

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error("STRIPE_SECRET_KEY is not set. Aborting.");
  process.exit(1);
}

if (mode === "test" && !secretKey.startsWith("sk_test_") && !secretKey.startsWith("rk_test_")) {
  console.error(
    `Refusing to run in --mode test with non-test STRIPE_SECRET_KEY (prefix=${secretKey.slice(0, 8)}). Pass --mode live to confirm.`
  );
  process.exit(1);
}

if (mode === "live" && !secretKey.startsWith("sk_live_") && !secretKey.startsWith("rk_live_")) {
  console.error(
    `Refusing to run in --mode live with non-live STRIPE_SECRET_KEY (prefix=${secretKey.slice(0, 8)}).`
  );
  process.exit(1);
}

const appUrl =
  appUrlOverride ??
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.AUTH_URL ??
  "https://deepglot.ai";

const webhookUrl = new URL("/api/webhooks/stripe", appUrl).toString();

const PAID_PLAN_INPUT: Array<{
  key: string;
  name: string;
  monthlyCents: number;
  yearlyCents: number;
  description: string;
}> = [
  { key: "STARTER", name: "Deepglot Starter", monthlyCents: 1300, yearlyCents: 13_000, description: "10,000 words/month, 1 language, 2 projects." },
  { key: "BUSINESS", name: "Deepglot Business", monthlyCents: 2500, yearlyCents: 25_000, description: "50,000 words/month, 3 languages, 3 projects." },
  { key: "PRO", name: "Deepglot Pro", monthlyCents: 6900, yearlyCents: 69_000, description: "200,000 words/month, 5 languages, 5 projects." },
  { key: "ADVANCED", name: "Deepglot Advanced", monthlyCents: 25_900, yearlyCents: 259_000, description: "1,000,000 words/month, 10 languages, 10 projects." },
  { key: "EXTENDED", name: "Deepglot Extended", monthlyCents: 59_900, yearlyCents: 599_000, description: "5,000,000 words/month, 20 languages, 25 projects." },
];

const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.deleted",
  "customer.subscription.updated",
];

async function main() {
  const apiKey = secretKey as string;
  const StripeMod = await import("stripe");
  const StripeCtor = StripeMod.default;
  const stripe: Stripe = new StripeCtor(apiKey, {
    apiVersion: "2026-02-25.clover",
    typescript: true,
  });

  console.log(`[stripe-setup] mode=${mode} app=${appUrl} webhook=${webhookUrl}`);
  console.log(`[stripe-setup] STRIPE_SECRET_KEY prefix=${apiKey.slice(0, 8)}...`);

  const envLines: string[] = [];

  for (const plan of PAID_PLAN_INPUT) {
    const product = await ensureProduct(stripe, plan);
    const monthlyPrice = await ensurePrice(stripe, product.id, plan.monthlyCents, "month", plan.key, "monthly");
    const yearlyPrice = await ensurePrice(stripe, product.id, plan.yearlyCents, "year", plan.key, "yearly");

    envLines.push(`STRIPE_PRICE_${plan.key}_MONTHLY="${monthlyPrice.id}"`);
    envLines.push(`STRIPE_PRICE_${plan.key}_YEARLY="${yearlyPrice.id}"`);
    console.log(`[stripe-setup] ${plan.key}: product=${product.id} monthly=${monthlyPrice.id} yearly=${yearlyPrice.id}`);
  }

  const webhook = await ensureWebhookEndpoint(stripe);
  console.log(`[stripe-setup] webhook endpoint id=${webhook.id} url=${webhook.url}`);
  if (webhook.secret) {
    envLines.push(`STRIPE_WEBHOOK_SECRET="${webhook.secret}"`);
  } else {
    envLines.push(`# STRIPE_WEBHOOK_SECRET cannot be re-read from Stripe after creation;`);
    envLines.push(`# rotate the existing webhook in the dashboard if you need a fresh secret.`);
  }

  console.log("");
  console.log("=== Paste into .env.production.local (and Vercel env): ===");
  console.log(envLines.join("\n"));
}

async function ensureProduct(stripe: Stripe, plan: { key: string; name: string; description: string }) {
  // Match by metadata.plan_key.
  const search = await stripe.products.search({
    query: `metadata['deepglot_plan_key']:'${plan.key}' AND active:'true'`,
    limit: 5,
  });

  if (search.data.length > 0) {
    const found = search.data[0];
    if (found.name !== plan.name || found.description !== plan.description) {
      const updated = await stripe.products.update(found.id, {
        name: plan.name,
        description: plan.description,
      });
      return updated;
    }
    return found;
  }

  return stripe.products.create({
    name: plan.name,
    description: plan.description,
    metadata: { deepglot_plan_key: plan.key },
  });
}

async function ensurePrice(
  stripe: Stripe,
  productId: string,
  unitAmount: number,
  interval: "month" | "year",
  planKey: string,
  intervalLabel: "monthly" | "yearly"
) {
  const search = await stripe.prices.search({
    query: `product:'${productId}' AND active:'true' AND metadata['deepglot_plan_key']:'${planKey}' AND metadata['deepglot_interval']:'${intervalLabel}'`,
    limit: 5,
  });

  for (const price of search.data) {
    if (
      price.unit_amount === unitAmount &&
      price.currency === "eur" &&
      price.recurring?.interval === interval
    ) {
      return price;
    }
  }

  // Deactivate any old matching price with a different amount.
  for (const price of search.data) {
    if (price.unit_amount !== unitAmount && price.active) {
      await stripe.prices.update(price.id, { active: false });
    }
  }

  return stripe.prices.create({
    product: productId,
    unit_amount: unitAmount,
    currency: "eur",
    recurring: { interval },
    metadata: {
      deepglot_plan_key: planKey,
      deepglot_interval: intervalLabel,
    },
  });
}

async function ensureWebhookEndpoint(stripe: Stripe): Promise<Stripe.WebhookEndpoint & { secret?: string }> {
  const enabledEvents = WEBHOOK_EVENTS as unknown as Stripe.WebhookEndpointCreateParams.EnabledEvent[];
  const all = await stripe.webhookEndpoints.list({ limit: 100 });

  const match = all.data.find((endpoint) => endpoint.url === webhookUrl);
  if (match) {
    const eventsMatch =
      match.enabled_events.length === WEBHOOK_EVENTS.length &&
      WEBHOOK_EVENTS.every((event) => match.enabled_events.includes(event));

    if (!eventsMatch || match.status !== "enabled") {
      const updated = await stripe.webhookEndpoints.update(match.id, {
        enabled_events: enabledEvents,
        disabled: false,
      });
      return { ...updated, secret: undefined };
    }
    return { ...match, secret: undefined };
  }

  return stripe.webhookEndpoints.create({
    url: webhookUrl,
    enabled_events: enabledEvents,
    metadata: { deepglot: "1" },
    description: "Deepglot subscription webhook",
  });
}

main().catch((error) => {
  console.error(`[stripe-setup] failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
