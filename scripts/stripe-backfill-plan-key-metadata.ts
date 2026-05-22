#!/usr/bin/env -S node --import tsx
/**
 * One-shot backfill: stamps the metadata keys that scripts/stripe-setup.ts
 * searches by onto the hand-curated Stripe Products and Prices that exist on
 * the Live account but were created directly in the Dashboard (so they never
 * received the metadata that the setup script searches by).
 *
 * Two phases:
 *
 *   1. Products. Each of the five Deepglot products (matched by exact name)
 *      gets `metadata.deepglot_plan_key = <KEY>`.
 *
 *   2. Prices. For each product, the two active recurring prices are matched
 *      against BILLING_PLANS by `unit_amount` + `recurring.interval` + `eur`
 *      currency, and each gets `metadata.deepglot_plan_key = <KEY>` and
 *      `metadata.deepglot_interval = <monthly|yearly>`.
 *
 * After both phases, re-running scripts/stripe-setup.ts becomes a true
 * idempotent no-op instead of creating duplicate products/prices.
 *
 * Matching is strict: the script refuses to write if it finds 0 or 2+ active
 * products for any tier, or 0 or 2+ active prices for any (tier, interval)
 * pair — those are the cases where a human needs to look at Stripe first.
 *
 * Only the metadata fields named above are written. `name`, `description`,
 * `unit_amount`, currency, and webhook endpoints are never written —
 * fully separate from scripts/stripe-setup.ts.
 *
 * Flags:
 *   --mode test|live   Default `test`. Refuses to run if the key prefix does
 *                      not match the chosen mode.
 *   --dry-run          Read-only. Lists every metadata write the script would
 *                      perform and prints a before/after diff. Never calls
 *                      stripe.products.update() or stripe.prices.update().
 *
 * Usage:
 *   STRIPE_SECRET_KEY=rk_live_… node --import tsx scripts/stripe-backfill-plan-key-metadata.ts --mode live --dry-run
 *   STRIPE_SECRET_KEY=rk_live_… node --import tsx scripts/stripe-backfill-plan-key-metadata.ts --mode live
 */

import { existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";
import type Stripe from "stripe";

import { BILLING_PLANS } from "@/lib/billing-plans";

const args = process.argv.slice(2);
const modeIndex = args.indexOf("--mode");
const mode: "test" | "live" =
  modeIndex >= 0 && args[modeIndex + 1] === "live" ? "live" : "test";
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

type PaidPlanKey = "STARTER" | "BUSINESS" | "PRO" | "ADVANCED" | "EXTENDED";

const TARGETS: Array<{ planKey: PaidPlanKey; name: string }> = [
  { planKey: "STARTER", name: "Deepglot Starter" },
  { planKey: "BUSINESS", name: "Deepglot Business" },
  { planKey: "PRO", name: "Deepglot Pro" },
  { planKey: "ADVANCED", name: "Deepglot Advanced" },
  { planKey: "EXTENDED", name: "Deepglot Extended" },
];

type Counters = { writes: number; skips: number; errors: number };
const accumulate = (a: Counters, b: Partial<Counters>): Counters => ({
  writes: a.writes + (b.writes ?? 0),
  skips: a.skips + (b.skips ?? 0),
  errors: a.errors + (b.errors ?? 0),
});

async function main() {
  const apiKey = secretKey as string;
  const StripeMod = await import("stripe");
  const StripeCtor = StripeMod.default;
  const stripe: Stripe = new StripeCtor(apiKey, {
    apiVersion: "2026-02-25.clover",
    typescript: true,
  });

  console.log(`[backfill] mode=${mode} dryRun=${dryRun}`);
  console.log(`[backfill] STRIPE_SECRET_KEY prefix=${apiKey.slice(0, 8)}...`);
  console.log("");

  const productResult = await backfillProducts(stripe);
  if (productResult.errors > 0) {
    console.error("\n[backfill] product phase had blocking errors; refusing to start price phase.");
    process.exit(1);
  }

  // Map of planKey -> matched product, populated by phase 1. Phase 2 needs it
  // to know which prices belong where.
  const priceResult = await backfillPrices(stripe, productResult.matched);

  const total = accumulate(
    { writes: productResult.writes, skips: productResult.skips, errors: productResult.errors },
    { writes: priceResult.writes, skips: priceResult.skips, errors: priceResult.errors }
  );

  console.log("");
  console.log(
    `[backfill] grand summary: writes=${total.writes} skips=${total.skips} errors=${total.errors} (dryRun=${dryRun})`
  );

  if (total.errors > 0) {
    process.exit(1);
  }
}

async function backfillProducts(stripe: Stripe): Promise<Counters & { matched: Map<PaidPlanKey, Stripe.Product> }> {
  console.log("=== Phase 1: products ===");
  const list = await stripe.products.list({ active: true, limit: 100 });
  const byName = new Map<string, Stripe.Product[]>();
  for (const product of list.data) {
    const bucket = byName.get(product.name) ?? [];
    bucket.push(product);
    byName.set(product.name, bucket);
  }

  const matched = new Map<PaidPlanKey, Stripe.Product>();
  let writes = 0;
  let skips = 0;
  let errors = 0;

  for (const target of TARGETS) {
    const candidates = byName.get(target.name) ?? [];

    if (candidates.length === 0) {
      console.error(`[backfill] ${target.planKey}: NO active product named ${JSON.stringify(target.name)} found. Skipping.`);
      errors++;
      continue;
    }

    if (candidates.length > 1) {
      console.error(
        `[backfill] ${target.planKey}: ${candidates.length} active products named ${JSON.stringify(target.name)} found — cannot disambiguate. Skipping.`
      );
      for (const p of candidates) {
        console.error(`    - ${p.id} (metadata=${JSON.stringify(p.metadata)})`);
      }
      errors++;
      continue;
    }

    const product = candidates[0];
    matched.set(target.planKey, product);

    const existing = product.metadata?.deepglot_plan_key;
    if (existing === target.planKey) {
      console.log(`[backfill] ${target.planKey}: ${product.id} already tagged — skipping.`);
      skips++;
      continue;
    }

    const direction = existing ? `(was ${JSON.stringify(existing)})` : "(was unset)";

    if (dryRun) {
      console.log(`[dry-run] ${target.planKey}: would set product metadata.deepglot_plan_key=${JSON.stringify(target.planKey)} on ${product.id} ${direction}`);
      writes++;
      continue;
    }

    await stripe.products.update(product.id, {
      metadata: { deepglot_plan_key: target.planKey },
    });
    console.log(`[backfill] ${target.planKey}: set product metadata.deepglot_plan_key=${JSON.stringify(target.planKey)} on ${product.id} ${direction}`);
    writes++;
  }

  console.log(`[backfill] phase 1 summary: writes=${writes} skips=${skips} errors=${errors}`);
  return { writes, skips, errors, matched };
}

async function backfillPrices(
  stripe: Stripe,
  matched: Map<PaidPlanKey, Stripe.Product>
): Promise<Counters> {
  console.log("");
  console.log("=== Phase 2: prices ===");

  let writes = 0;
  let skips = 0;
  let errors = 0;

  for (const target of TARGETS) {
    const product = matched.get(target.planKey);
    if (!product) {
      // Already reported as an error in phase 1 — skip silently here.
      continue;
    }

    const plan = BILLING_PLANS[target.planKey];
    if (plan.monthlyPriceCents === null || plan.yearlyPriceCents === null) {
      console.error(`[backfill] ${target.planKey}: BILLING_PLANS has null monthly/yearly price — refusing to match prices.`);
      errors++;
      continue;
    }

    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 20 });

    const intervals: Array<{ interval: "month" | "year"; label: "monthly" | "yearly"; expectedCents: number }> = [
      { interval: "month", label: "monthly", expectedCents: plan.monthlyPriceCents },
      { interval: "year", label: "yearly", expectedCents: plan.yearlyPriceCents },
    ];

    for (const spec of intervals) {
      const matches = prices.data.filter(
        (p) =>
          p.recurring?.interval === spec.interval &&
          p.currency === "eur" &&
          p.unit_amount === spec.expectedCents
      );

      if (matches.length === 0) {
        console.error(
          `[backfill] ${target.planKey} ${spec.label}: NO active price found with ${spec.expectedCents} EUR / ${spec.interval} on product ${product.id}. Skipping.`
        );
        errors++;
        continue;
      }

      if (matches.length > 1) {
        console.error(
          `[backfill] ${target.planKey} ${spec.label}: ${matches.length} prices match ${spec.expectedCents} EUR / ${spec.interval} on product ${product.id} — cannot disambiguate. Skipping.`
        );
        for (const p of matches) {
          console.error(`    - ${p.id} (metadata=${JSON.stringify(p.metadata)})`);
        }
        errors++;
        continue;
      }

      const price = matches[0];
      const existingKey = price.metadata?.deepglot_plan_key;
      const existingInterval = price.metadata?.deepglot_interval;
      const alreadyTagged = existingKey === target.planKey && existingInterval === spec.label;

      if (alreadyTagged) {
        console.log(`[backfill] ${target.planKey} ${spec.label}: ${price.id} already tagged — skipping.`);
        skips++;
        continue;
      }

      const direction = `(was deepglot_plan_key=${JSON.stringify(existingKey ?? null)}, deepglot_interval=${JSON.stringify(existingInterval ?? null)})`;

      if (dryRun) {
        console.log(
          `[dry-run] ${target.planKey} ${spec.label}: would set price metadata on ${price.id} to {deepglot_plan_key:${JSON.stringify(target.planKey)}, deepglot_interval:${JSON.stringify(spec.label)}} ${direction}`
        );
        writes++;
        continue;
      }

      await stripe.prices.update(price.id, {
        metadata: { deepglot_plan_key: target.planKey, deepglot_interval: spec.label },
      });
      console.log(
        `[backfill] ${target.planKey} ${spec.label}: set price metadata on ${price.id} ${direction}`
      );
      writes++;
    }
  }

  console.log(`[backfill] phase 2 summary: writes=${writes} skips=${skips} errors=${errors}`);
  return { writes, skips, errors };
}

main().catch((error) => {
  console.error(`[backfill] failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
