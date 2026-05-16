import { SignupCard } from "@/components/auth/signup-card";
import { getEnabledOAuthProviders } from "@/lib/oauth-provider-config";
import {
  BILLING_PLAN_KEYS,
  type BillingInterval,
  type BillingPlanKey,
} from "@/lib/billing-plans";
import type { LocaleSearchParams } from "@/lib/request-locale";

type SignupPageProps = {
  searchParams: LocaleSearchParams;
};

const PAID_PLAN_KEYS = BILLING_PLAN_KEYS.filter(
  (key) => key !== "FREE" && key !== "ENTERPRISE"
);

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const enabledOAuthProviders = getEnabledOAuthProviders();
  const resolved = await searchParams;

  const planParam = first(resolved.plan);
  const intervalParam = first(resolved.interval);

  const checkoutPlan = (PAID_PLAN_KEYS as readonly string[]).includes(
    planParam ?? ""
  )
    ? (planParam as BillingPlanKey)
    : undefined;
  const checkoutInterval: BillingInterval =
    intervalParam === "yearly" ? "yearly" : "monthly";

  return (
    <SignupCard
      canUseGitHubLogin={enabledOAuthProviders.github}
      canUseGoogleLogin={enabledOAuthProviders.google}
      checkoutPlan={checkoutPlan}
      checkoutInterval={checkoutInterval}
    />
  );
}
