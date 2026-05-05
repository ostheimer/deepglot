import { LoginCard } from "@/components/auth/login-card";
import { getEnabledOAuthProviders } from "@/lib/oauth-provider-config";
import { getRequestLocale } from "@/lib/request-locale";
import { getSafeAuthCallbackUrl } from "@/lib/route-access";
import { withLocalePrefix } from "@/lib/site-locale";
import {
  getTestLoginConfig,
  isTestLoginEnabled,
} from "@/lib/test-login-config";

type LoginPageProps = {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const locale = await getRequestLocale();
  const { callbackUrl: rawCallbackUrl } = await searchParams;
  const enabledOAuthProviders = getEnabledOAuthProviders();
  const callbackUrl = getSafeAuthCallbackUrl(
    rawCallbackUrl,
    withLocalePrefix("/dashboard", locale)
  );

  return (
    <LoginCard
      canUseTestLogin={isTestLoginEnabled()}
      canUseGitHubLogin={enabledOAuthProviders.github}
      canUseGoogleLogin={enabledOAuthProviders.google}
      testLoginEmail={getTestLoginConfig().email}
      callbackUrl={callbackUrl}
    />
  );
}
