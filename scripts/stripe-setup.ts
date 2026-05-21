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
 * Flags:
 *   --mode test|live          Default `test`. Refuses to run if the key prefix
 *                             does not match the chosen mode.
 *   --app-url <url>           Override the webhook base URL (default reads
 *                             NEXT_PUBLIC_APP_URL / AUTH_URL / falls back to
 *                             https://deepglot.ai).
 *   --lang de|en              Locale for the Stripe Product description shown
 *                             on the hosted Checkout page. Default `de`
 *                             because Deepglot is German-first and the live
 *                             products today carry hand-curated German copy;
 *                             re-running --mode live with the default never
 *                             swaps Checkout from German to English.
 *   --dry-run                 Read-only. Lists every product/price/webhook
 *                             change the script would make and prints a
 *                             before/after diff for each, but never calls
 *                             stripe.*.create() or stripe.*.update().
 *
 * Usage:
 *   STRIPE_SECRET_KEY=rk_test_… node --import tsx scripts/stripe-setup.ts
 *   STRIPE_SECRET_KEY=rk_test_… node --import tsx scripts/stripe-setup.ts --mode live
 *   STRIPE_SECRET_KEY=rk_live_… node --import tsx scripts/stripe-setup.ts --mode live --dry-run
 *   STRIPE_SECRET_KEY=rk_live_… node --import tsx scripts/stripe-setup.ts --mode live --lang en --dry-run
 */

import { existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";
import type Stripe from "stripe";

import {
  BILLING_PLANS,
  formatStripeProductDescription,
  type StripeDescriptionLocale,
} from "@/lib/billing-plans";

const args = process.argv.slice(2);
const modeIndex = args.indexOf("--mode");
const mode: "test" | "live" =
  modeIndex >= 0 && args[modeIndex + 1] === "live" ? "live" : "test";
const appUrlOverride = (() => {
  const i = args.indexOf("--app-url");
  return i >= 0 ? args[i + 1] : undefined;
})();
const langIndex = args.indexOf("--lang");
const langArg = langIndex >= 0 ? args[langIndex + 1] : undefined;
if (langArg !== undefined && langArg !== "de" && langArg !== "en") {
  console.error(`Refusing to run with --lang ${langArg}: must be "de" or "en".`);
  process.exit(1);
}
const lang: StripeDescriptionLocale = langArg === "en" ? "en" : "de";
const dryRun = args.includes("--dry-run");

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

const PAID_PLAN_KEYS = ["STARTER", "BUSINESS", "PRO", "ADVANCED", "EXTENDED"] as const;

const PAID_PLAN_INPUT: Array<{
  key: (typeof PAID_PLAN_KEYS)[number];
  name: string;
  monthlyCents: number;
  yearlyCents: number;
  description: string;
}> = PAID_PLAN_KEYS.map((key) => {
  const plan = BILLING_PLANS[key];
  if (plan.monthlyPriceCents === null || plan.yearlyPriceCents === null) {
    throw new Error(`Paid plan ${key} has no monthly/yearly price configured in BILLING_PLANS.`);
  }
  return {
    key,
    name: `Deepglot ${plan.name}`,
    monthlyCents: plan.monthlyPriceCents,
    yearlyCents: plan.yearlyPriceCents,
    description: formatStripeProductDescription(key, lang),
  };
});

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

  console.log(
    `[stripe-setup] mode=${mode} lang=${lang} dryRun=${dryRun} app=${appUrl} webhook=${webhookUrl}`
  );
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
  } else if (!dryRun) {
    envLines.push(`# STRIPE_WEBHOOK_SECRET cannot be re-read from Stripe after creation;`);
    envLines.push(`# rotate the existing webhook in the dashboard if you need a fresh secret.`);
  }

  console.log("");
  if (dryRun) {
    console.log("=== Dry-run complete. No Stripe state was mutated. ===");
  } else {
    console.log("=== Paste into .env.production.local (and Vercel env): ===");
    console.log(envLines.join("\n"));
  }
}

async function ensureProduct(
  stripe: Stripe,
  plan: { key: string; name: string; description: string }
): Promise<Stripe.Product> {
  // Match by metadata.plan_key.
  const search = await stripe.products.search({
    query: `metadata['deepglot_plan_key']:'${plan.key}' AND active:'true'`,
    limit: 5,
  });

  if (search.data.length > 0) {
    const found = search.data[0];
    const nameChanged = found.name !== plan.name;
    const descriptionChanged = found.description !== plan.description;

    if (!nameChanged && !descriptionChanged) {
      return found;
    }

    if (dryRun) {
      console.log(`[dry-run] product ${plan.key} (${found.id}) would change:`);
      if (nameChanged) {
        console.log(`  name:        ${JSON.stringify(found.name)}`);
        console.log(`           ->  ${JSON.stringify(plan.name)}`);
      }
      if (descriptionChanged) {
        console.log(`  description: ${JSON.stringify(found.description)}`);
        console.log(`           ->  ${JSON.stringify(plan.description)}`);
      }
      return found;
    }

    return await stripe.products.update(found.id, {
      name: plan.name,
      description: plan.description,
    });
  }

  if (dryRun) {
    console.log(`[dry-run] product ${plan.key} would be created:`);
    console.log(`  name:        ${JSON.stringify(plan.name)}`);
    console.log(`  description: ${JSON.stringify(plan.description)}`);
    return {
      id: `prod_dryrun_${plan.key}`,
      name: plan.name,
      description: plan.description,
    } as unknown as Stripe.Product;
  }

  return await stripe.products.create({
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
): Promise<Stripe.Price> {
  if (dryRun && productId.startsWith("prod_dryrun_")) {
    // Product itself does not exist in Stripe yet (would be created by a real
    // run), so there is nothing to search. Report the create that would
    // follow and return a synthetic price record so envLines stays meaningful.
    console.log(
      `[dry-run] price ${planKey} ${intervalLabel} would be created: ${unitAmount} EUR ${interval}`
    );
    return {
      id: `price_dryrun_${planKey}_${intervalLabel}`,
      unit_amount: unitAmount,
      currency: "eur",
      recurring: { interval },
    } as unknown as Stripe.Price;
  }

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
      if (dryRun) {
        console.log(
          `[dry-run] price ${planKey} ${intervalLabel} (${price.id}) would be deactivated: ${price.unit_amount} EUR -> ${unitAmount} EUR`
        );
      } else {
        await stripe.prices.update(price.id, { active: false });
      }
    }
  }

  if (dryRun) {
    console.log(
      `[dry-run] price ${planKey} ${intervalLabel} would be created on product ${productId}: ${unitAmount} EUR ${interval}`
    );
    return {
      id: `price_dryrun_${planKey}_${intervalLabel}`,
      unit_amount: unitAmount,
      currency: "eur",
      recurring: { interval },
    } as unknown as Stripe.Price;
  }

  return await stripe.prices.create({
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
      if (dryRun) {
        console.log(
          `[dry-run] webhook ${match.id} (${match.url}) would be updated: events ${JSON.stringify(
            match.enabled_events
          )} -> ${JSON.stringify(WEBHOOK_EVENTS)}, status=${match.status} -> enabled`
        );
        return { ...match, secret: undefined };
      }
      const updated = await stripe.webhookEndpoints.update(match.id, {
        enabled_events: enabledEvents,
        disabled: false,
      });
      return { ...updated, secret: undefined };
    }
    return { ...match, secret: undefined };
  }

  if (dryRun) {
    console.log(`[dry-run] webhook would be created: url=${webhookUrl} events=${JSON.stringify(WEBHOOK_EVENTS)}`);
    return {
      id: "we_dryrun",
      url: webhookUrl,
      enabled_events: WEBHOOK_EVENTS as unknown as Stripe.WebhookEndpoint["enabled_events"],
      status: "enabled",
      secret: undefined,
    } as unknown as Stripe.WebhookEndpoint & { secret?: string };
  }

  return await stripe.webhookEndpoints.create({
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
