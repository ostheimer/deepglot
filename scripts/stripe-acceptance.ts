import dotenv from "dotenv";
import Stripe from "stripe";

import {
  REQUIRED_STRIPE_WEBHOOK_EVENTS,
  validateStripeAcceptanceConfig,
  validateStripePriceResource,
  type StripeAcceptanceEnv,
  type StripeAcceptanceMode,
} from "@/lib/stripe-acceptance";

type Options = {
  mode: StripeAcceptanceMode;
  envFile: string | null;
  envOnly: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    mode: "test",
    envFile: null,
    envOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--mode" && (next === "test" || next === "live")) {
      options.mode = next;
      index += 1;
    } else if (arg === "--env-file" && next) {
      options.envFile = next;
      index += 1;
    } else if (arg === "--env-only") {
      options.envOnly = true;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: npm run acceptance:stripe -- [options]

Options:
  --mode test|live       Validate test or live Stripe configuration. Default: test
  --env-file <path>      Load environment values from a dotenv file.
  --env-only             Validate local env shape only; skip Stripe API reads.

The script never creates charges, customers, subscriptions, or prices.`);
}

function loadEnvFile(path: string | null) {
  if (!path) {
    return;
  }

  const result = dotenv.config({ path, quiet: true });
  if (result.error) {
    throw result.error;
  }
}

function getWebhookBaseUrl() {
  const baseUrl = process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) {
    return null;
  }

  return baseUrl.startsWith("http://") || baseUrl.startsWith("https://")
    ? baseUrl
    : `https://${baseUrl}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFile(options.envFile);

  const validation = validateStripeAcceptanceConfig({
    mode: options.mode,
    env: process.env as StripeAcceptanceEnv,
  });

  if (!validation.ok) {
    console.error("FAIL Stripe acceptance configuration:");
    validation.errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  if (options.envOnly) {
    console.log(`PASS Stripe ${options.mode} env-only configuration validation.`);
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2026-02-25.clover",
    typescript: true,
  });

  const priceErrors: string[] = [];

  for (const price of validation.priceIds) {
    const stripePrice = await stripe.prices.retrieve(price.id);
    priceErrors.push(
      ...validateStripePriceResource({
        key: price.key,
        id: price.id,
        livemode: stripePrice.livemode,
        active: stripePrice.active,
        interval: stripePrice.recurring?.interval,
        expectedLivemode: validation.expectedLivemode,
      })
    );
  }

  if (priceErrors.length > 0) {
    console.error("FAIL Stripe price validation:");
    priceErrors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  const webhookBaseUrl = getWebhookBaseUrl();
  if (!webhookBaseUrl) {
    console.error("FAIL AUTH_URL or NEXT_PUBLIC_APP_URL is required for webhook validation.");
    process.exit(1);
  }

  const expectedWebhookUrl = new URL("/api/webhooks/stripe", webhookBaseUrl).toString();
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const endpoint = endpoints.data.find((item) => {
    return item.url === expectedWebhookUrl && item.livemode === validation.expectedLivemode;
  });

  if (!endpoint) {
    console.error(`FAIL Stripe webhook endpoint not found: ${expectedWebhookUrl}`);
    process.exit(1);
  }

  const enabledEvents = new Set(endpoint.enabled_events);
  const missingEvents = REQUIRED_STRIPE_WEBHOOK_EVENTS.filter((event) => {
    return !enabledEvents.has("*") && !enabledEvents.has(event);
  });

  if (missingEvents.length > 0) {
    console.error("FAIL Stripe webhook endpoint is missing events:");
    missingEvents.forEach((event) => console.error(`- ${event}`));
    process.exit(1);
  }

  console.log(
    `PASS Stripe ${options.mode} API validation: prices active and webhook endpoint configured.`
  );
}

main().catch((error) => {
  console.error("FAIL Stripe acceptance check:", error instanceof Error ? error.message : error);
  process.exit(1);
});
