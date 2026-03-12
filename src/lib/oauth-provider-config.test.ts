import assert from "node:assert/strict";
import test from "node:test";

import { getEnabledOAuthProviders } from "@/lib/oauth-provider-config";

test("enables GitHub and Google only when both required secrets are present", () => {
  assert.deepEqual(
    getEnabledOAuthProviders({
      AUTH_GITHUB_ID: "github-id",
      AUTH_GITHUB_SECRET: "github-secret",
      AUTH_GOOGLE_ID: "google-id",
      AUTH_GOOGLE_SECRET: "google-secret",
    }),
    {
      github: true,
      google: true,
    }
  );
});

test("disables providers with partial or empty local configuration", () => {
  assert.deepEqual(
    getEnabledOAuthProviders({
      AUTH_GITHUB_ID: "github-id",
      AUTH_GITHUB_SECRET: "",
      AUTH_GOOGLE_ID: "",
      AUTH_GOOGLE_SECRET: "google-secret",
    }),
    {
      github: false,
      google: false,
    }
  );
});
