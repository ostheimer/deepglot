import test from "node:test";
import assert from "node:assert/strict";

import { getAuthRedirect } from "@/lib/route-access";

test("redirects unauthenticated users from protected routes", () => {
  assert.equal(getAuthRedirect("/dashboard", false), "/anmelden");
  assert.equal(getAuthRedirect("/dashboard/stats", false), "/anmelden");
  assert.equal(getAuthRedirect("/projekte/neu", false), "/anmelden");
  assert.equal(getAuthRedirect("/abonnement/nutzung", false), "/anmelden");
});

test("redirects authenticated users away from auth routes", () => {
  assert.equal(getAuthRedirect("/anmelden", true), "/dashboard");
  assert.equal(getAuthRedirect("/registrieren", true), "/dashboard");
});

test("allows public routes and exact-prefix edge cases", () => {
  assert.equal(getAuthRedirect("/", false), null);
  assert.equal(getAuthRedirect("/preise", false), null);
  assert.equal(getAuthRedirect("/dashboarding", false), null);
  assert.equal(getAuthRedirect("/registrierung", true), null);
});
