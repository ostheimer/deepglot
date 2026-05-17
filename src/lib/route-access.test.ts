import test from "node:test";
import assert from "node:assert/strict";

import { getAuthRedirect, getSafeAuthCallbackUrl } from "@/lib/route-access";

test("redirects unauthenticated users from protected routes", () => {
  assert.equal(getAuthRedirect("/dashboard", false), "/login");
  assert.equal(getAuthRedirect("/dashboard/stats", false), "/login");
  assert.equal(getAuthRedirect("/projects/new", false), "/login");
  assert.equal(getAuthRedirect("/subscription/usage", false), "/login");
  assert.equal(getAuthRedirect("/de/projects/new", false), "/de/anmelden");
  assert.equal(getAuthRedirect("/fr/projets/nouveau", false), "/fr/connexion");
});

test("redirects authenticated users away from auth routes", () => {
  assert.equal(getAuthRedirect("/login", true), "/dashboard");
  assert.equal(getAuthRedirect("/signup", true), "/dashboard");
  assert.equal(getAuthRedirect("/forgot-password", true), "/dashboard");
  assert.equal(getAuthRedirect("/reset-password", true), "/dashboard");
  assert.equal(getAuthRedirect("/de/login", true), "/de/dashboard");
  assert.equal(getAuthRedirect("/de/anmelden", true), "/de/dashboard");
  assert.equal(getAuthRedirect("/de/signup", true), "/de/dashboard");
  assert.equal(getAuthRedirect("/de/forgot-password", true), "/de/dashboard");
  assert.equal(getAuthRedirect("/fr/connexion", true), "/fr/tableau-de-bord");
});

test("allows public routes and exact-prefix edge cases", () => {
  assert.equal(getAuthRedirect("/", false), null);
  assert.equal(getAuthRedirect("/pricing", false), null);
  assert.equal(getAuthRedirect("/de/preise", false), null);
  assert.equal(getAuthRedirect("/dashboarding", false), null);
  assert.equal(getAuthRedirect("/signups", true), null);
});

test("keeps auth callback URLs same-origin and relative", () => {
  assert.equal(
    getSafeAuthCallbackUrl("/accept-invite?token=abc", "/dashboard"),
    "/accept-invite?token=abc"
  );
  assert.equal(getSafeAuthCallbackUrl("https://evil.test", "/dashboard"), "/dashboard");
  assert.equal(getSafeAuthCallbackUrl("//evil.test", "/dashboard"), "/dashboard");
  assert.equal(getSafeAuthCallbackUrl(undefined, "/dashboard"), "/dashboard");
});
