import test from "node:test";
import assert from "node:assert/strict";

import {
  getDocumentLocale,
  getLegacyPublicRedirect,
  getMarketingPath,
  getLocalizedPathname,
  toCanonicalExternalPath,
  toInternalPath,
} from "@/lib/site-locale";

test("detects document locale from localized and app paths", () => {
  assert.equal(getDocumentLocale("/"), "en");
  assert.equal(getDocumentLocale("/pricing"), "en");
  assert.equal(getDocumentLocale("/login"), "en");
  assert.equal(getDocumentLocale("/de"), "de");
  assert.equal(getDocumentLocale("/de/pricing"), "de");
  assert.equal(getDocumentLocale("/dashboard"), "en");
  assert.equal(getDocumentLocale("/de/projects/new"), "de");
});

test("maps marketing routes per locale", () => {
  assert.equal(getMarketingPath("en", "home"), "/");
  assert.equal(getMarketingPath("en", "pricing"), "/pricing");
  assert.equal(getMarketingPath("de", "home"), "/de");
  assert.equal(getMarketingPath("de", "pricing"), "/de/pricing");
  assert.equal(getMarketingPath("de", "login"), "/de/login");
  assert.equal(getMarketingPath("de", "signup"), "/de/signup");
  assert.equal(getMarketingPath("en", "forgotPassword"), "/forgot-password");
  assert.equal(getMarketingPath("de", "forgotPassword"), "/de/forgot-password");
  assert.equal(getMarketingPath("de", "resetPassword"), "/de/reset-password");
  assert.equal(getMarketingPath("de", "acceptInvite"), "/de/accept-invite");
});

test("converts external english routes to internal app paths", () => {
  assert.equal(toInternalPath("/projects/new"), "/projekte/neu");
  assert.equal(toInternalPath("/de/projects/123/translations/languages"), "/projekte/123/uebersetzungen/sprachen");
  assert.equal(toInternalPath("/projects/123/settings/members"), "/projekte/123/einstellungen/mitglieder");
  assert.equal(toInternalPath("/pricing"), "/pricing");
});

test("leaves api routes unchanged during locale path mapping", () => {
  assert.equal(toInternalPath("/api/projects"), "/api/projects");
  assert.equal(toInternalPath("/de/api/projects"), "/api/projects");
  assert.equal(toCanonicalExternalPath("/api/public/languages"), "/api/public/languages");
});

test("converts internal legacy routes to canonical external paths", () => {
  assert.equal(toCanonicalExternalPath("/projekte/neu"), "/projects/new");
  assert.equal(toCanonicalExternalPath("/projekte/123/einstellungen/mitglieder"), "/projects/123/settings/members");
  assert.equal(toCanonicalExternalPath("/abonnement/karte-rechnungen"), "/subscription/billing");
  assert.equal(toCanonicalExternalPath("/preise"), "/pricing");
});

test("builds localized canonical pathnames", () => {
  assert.equal(getLocalizedPathname("/projects/new", "de"), "/de/projects/new");
  assert.equal(getLocalizedPathname("/de/projects/new", "en"), "/projects/new");
  assert.equal(getLocalizedPathname("/projekte/neu", "de"), "/de/projects/new");
});

test("returns legacy redirects for moved german routes", () => {
  assert.equal(getLegacyPublicRedirect("/preise"), "/de/pricing");
  assert.equal(getLegacyPublicRedirect("/anmelden"), "/de/login");
  assert.equal(getLegacyPublicRedirect("/registrieren"), "/de/signup");
  assert.equal(getLegacyPublicRedirect("/projekte/neu"), "/de/projects/new");
  assert.equal(getLegacyPublicRedirect("/de/projekte/neu"), "/de/projects/new");
  assert.equal(getLegacyPublicRedirect("/pricing"), null);
});
