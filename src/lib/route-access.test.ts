import test from "node:test";
import assert from "node:assert/strict";

import { getAuthRedirect } from "@/lib/route-access";

test("redirects unauthenticated users from protected routes", () => {
  assert.equal(getAuthRedirect("/dashboard", false), "/login");
  assert.equal(getAuthRedirect("/dashboard/stats", false), "/login");
  assert.equal(getAuthRedirect("/projects/new", false), "/login");
  assert.equal(getAuthRedirect("/subscription/usage", false), "/login");
  assert.equal(getAuthRedirect("/de/projects/new", false), "/de/login");
});

test("redirects authenticated users away from auth routes", () => {
  assert.equal(getAuthRedirect("/login", true), "/dashboard");
  assert.equal(getAuthRedirect("/signup", true), "/dashboard");
  assert.equal(getAuthRedirect("/forgot-password", true), "/dashboard");
  assert.equal(getAuthRedirect("/reset-password", true), "/dashboard");
  assert.equal(getAuthRedirect("/de/login", true), "/de/dashboard");
  assert.equal(getAuthRedirect("/de/signup", true), "/de/dashboard");
  assert.equal(getAuthRedirect("/de/forgot-password", true), "/de/dashboard");
});

test("allows public routes and exact-prefix edge cases", () => {
  assert.equal(getAuthRedirect("/", false), null);
  assert.equal(getAuthRedirect("/pricing", false), null);
  assert.equal(getAuthRedirect("/de/pricing", false), null);
  assert.equal(getAuthRedirect("/dashboarding", false), null);
  assert.equal(getAuthRedirect("/signups", true), null);
});
