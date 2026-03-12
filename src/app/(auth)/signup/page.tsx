import { SignupCard } from "@/components/auth/signup-card";
import { getEnabledOAuthProviders } from "@/lib/oauth-provider-config";

export default function SignupPage() {
  const enabledOAuthProviders = getEnabledOAuthProviders();

  return (
    <SignupCard
      canUseGitHubLogin={enabledOAuthProviders.github}
      canUseGoogleLogin={enabledOAuthProviders.google}
    />
  );
}
