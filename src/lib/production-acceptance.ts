import type { AcceptanceCheck } from "@/lib/acceptance-report";
import {
  getNeonRestoreDrillValidation,
  type NeonRestoreDrillEnv,
} from "@/lib/neon-restore-drill";
import { getRateLimitConfig } from "@/lib/rate-limit";
import {
  validateStripeAcceptanceConfig,
  type StripeAcceptanceEnv,
  type StripeAcceptanceMode,
} from "@/lib/stripe-acceptance";

export function redactAcceptanceOutput(value: string) {
  return value
    .replace(/sk_(live|test)_[A-Za-z0-9_]+/g, "sk_$1_[redacted]")
    .replace(/pk_(live|test)_[A-Za-z0-9_]+/g, "pk_$1_[redacted]")
    .replace(/whsec_[A-Za-z0-9_]+/g, "whsec_[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]");
}

export function buildNeonLiveReadinessCheck(env: NeonRestoreDrillEnv): AcceptanceCheck {
  const validation = getNeonRestoreDrillValidation({
    env,
    create: true,
    sourceBranch: "prod",
    branchName: "restore-drill-prod-readiness",
  });

  if (!validation.ok) {
    return {
      name: "Neon live restore-drill readiness",
      status: "BLOCKED",
      detail: validation.errors.join(" "),
    };
  }

  return {
    name: "Neon live restore-drill readiness",
    status: "PASS",
    detail: "NEON_API_KEY is configured; live branch creation can be run with --create-neon-branch.",
  };
}

export function buildStripeReadinessCheck({
  mode,
  env,
}: {
  mode: StripeAcceptanceMode;
  env: StripeAcceptanceEnv;
}): AcceptanceCheck {
  const validation = validateStripeAcceptanceConfig({ mode, env });

  if (!validation.ok) {
    return {
      name: `Stripe ${mode} configuration readiness`,
      status: "BLOCKED",
      detail: `Postponed external dependency until Stripe ${mode} billing configuration is intentionally created. ${validation.errors.join(" ")}`,
    };
  }

  return {
    name: `Stripe ${mode} configuration readiness`,
    status: "PASS",
    detail: "Stripe key mode, webhook secret, and monthly price IDs are configured.",
  };
}

export function buildRateLimitReadinessCheck(
  env: {
    TRANSLATE_RATE_LIMIT_PER_MINUTE?: string;
    PLUGIN_RATE_LIMIT_PER_MINUTE?: string;
    AUTH_RATE_LIMIT_PER_MINUTE?: string;
  } = {}
): AcceptanceCheck {
  const config = getRateLimitConfig(env);

  return {
    name: "Rate-limit configuration",
    status: "PASS",
    detail: `translate=${config.translatePerMinute}/min, plugin=${config.pluginPerMinute}/min, auth=${config.authPerMinute}/min.`,
  };
}

export function buildWebhookProcessorReadinessCheck({
  cronSecret,
  runRequested,
}: {
  cronSecret?: string;
  runRequested: boolean;
}): AcceptanceCheck {
  if (cronSecret?.trim()) {
    return {
      name: "Webhook processor readiness",
      status: "PASS",
      detail: runRequested
        ? "CRON_SECRET is configured; processor request can be authenticated."
        : "CRON_SECRET is configured; processor execution was not requested.",
    };
  }

  return {
    name: "Webhook processor readiness",
    status: runRequested ? "FAIL" : "BLOCKED",
    detail: "CRON_SECRET is required to verify the production webhook processor endpoint.",
  };
}
