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
