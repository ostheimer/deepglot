import { LoginCard } from "@/components/auth/login-card";
import { getEnabledOAuthProviders } from "@/lib/oauth-provider-config";
import {
  getTestLoginConfig,
  isTestLoginEnabled,
} from "@/lib/test-login-config";

export default function LoginPage() {
  const enabledOAuthProviders = getEnabledOAuthProviders();

  return (
    <LoginCard
      canUseTestLogin={isTestLoginEnabled()}
      canUseGitHubLogin={enabledOAuthProviders.github}
      canUseGoogleLogin={enabledOAuthProviders.google}
      testLoginEmail={getTestLoginConfig().email}
    />
  );
}
