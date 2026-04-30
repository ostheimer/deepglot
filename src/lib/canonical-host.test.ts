import assert from "node:assert/strict";
import test from "node:test";

import { getCanonicalHostRedirectUrl } from "@/lib/canonical-host";

test("redirects www.deepglot.ai to the canonical apex host", () => {
  const redirectUrl = getCanonicalHostRedirectUrl(
    new URL("https://www.deepglot.ai/de/pricing?plan=starter"),
    "www.deepglot.ai"
  );

  assert.equal(
    redirectUrl?.toString(),
    "https://deepglot.ai/de/pricing?plan=starter"
  );
});

test("leaves the canonical apex host unchanged", () => {
  assert.equal(
    getCanonicalHostRedirectUrl(
      new URL("https://deepglot.ai/pricing"),
      "deepglot.ai"
    ),
    null
  );
});

test("ignores deployment and localhost hosts", () => {
  assert.equal(
    getCanonicalHostRedirectUrl(
      new URL("https://deepglot-git-main.example.vercel.app/pricing"),
      "deepglot-git-main.example.vercel.app"
    ),
    null
  );
  assert.equal(
    getCanonicalHostRedirectUrl(
      new URL("http://localhost:3000/pricing"),
      "localhost:3000"
    ),
    null
  );
});

test("redirects configured production aliases to the canonical apex host", () => {
  const redirectUrl = getCanonicalHostRedirectUrl(
    new URL("https://deepglot-old.example.vercel.app/pricing?plan=starter"),
    "deepglot-old.example.vercel.app",
    {
      VERCEL_ENV: "production",
      DEEPGLOT_CANONICAL_REDIRECT_HOSTS:
        "deepglot-old.example.vercel.app, deepglot-legacy.example.vercel.app",
    }
  );

  assert.equal(
    redirectUrl?.toString(),
    "https://deepglot.ai/pricing?plan=starter"
  );
});

test("redirects the current Vercel production deployment host", () => {
  const redirectUrl = getCanonicalHostRedirectUrl(
    new URL("https://deepglot-current.vercel.app/dashboard"),
    "deepglot-current.vercel.app",
    {
      VERCEL_ENV: "production",
      VERCEL_URL: "deepglot-current.vercel.app",
    }
  );

  assert.equal(redirectUrl?.toString(), "https://deepglot.ai/dashboard");
});

test("keeps preview deployment hosts reachable even when Vercel URL is set", () => {
  assert.equal(
    getCanonicalHostRedirectUrl(
      new URL("https://deepglot-git-feature.vercel.app/pricing"),
      "deepglot-git-feature.vercel.app",
      {
        VERCEL_ENV: "preview",
        VERCEL_URL: "deepglot-git-feature.vercel.app",
        DEEPGLOT_CANONICAL_REDIRECT_HOSTS: "deepglot-git-feature.vercel.app",
      }
    ),
    null
  );
});
