export type OAuthProviderEnv = Record<string, string | undefined>;

export function getEnabledOAuthProviders(
  env: OAuthProviderEnv = process.env
) {
  return {
    github: Boolean(env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET),
    google: Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET),
  };
}
