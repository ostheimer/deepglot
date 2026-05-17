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
  assert.equal(getDocumentLocale("/fr/tarifs"), "fr");
  assert.equal(getDocumentLocale("/dashboard"), "en");
  assert.equal(getDocumentLocale("/de/projects/new"), "de");
});

test("maps marketing routes per locale", () => {
  assert.equal(getMarketingPath("en", "home"), "/");
  assert.equal(getMarketingPath("en", "pricing"), "/pricing");
  assert.equal(getMarketingPath("de", "home"), "/de");
  assert.equal(getMarketingPath("de", "pricing"), "/de/preise");
  assert.equal(getMarketingPath("de", "login"), "/de/anmelden");
  assert.equal(getMarketingPath("de", "signup"), "/de/registrieren");
  assert.equal(getMarketingPath("fr", "pricing"), "/fr/tarifs");
  assert.equal(getMarketingPath("en", "forgotPassword"), "/forgot-password");
  assert.equal(getMarketingPath("de", "forgotPassword"), "/de/passwort-vergessen");
  assert.equal(getMarketingPath("de", "resetPassword"), "/de/passwort-zuruecksetzen");
  assert.equal(getMarketingPath("de", "acceptInvite"), "/de/einladung-annehmen");
});

test("converts external english routes to internal app paths", () => {
  assert.equal(toInternalPath("/projects/new"), "/projekte/neu");
  assert.equal(toInternalPath("/de/projects/123/translations/languages"), "/projekte/123/uebersetzungen/sprachen");
  assert.equal(toInternalPath("/fr/projets/123/traductions/langues"), "/projekte/123/uebersetzungen/sprachen");
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
  assert.equal(getLocalizedPathname("/projects/new", "de"), "/de/projekte/neu");
  assert.equal(getLocalizedPathname("/projects/new", "fr"), "/fr/projets/nouveau");
  assert.equal(getLocalizedPathname("/de/projects/new", "en"), "/projects/new");
  assert.equal(getLocalizedPathname("/projekte/neu", "de"), "/de/projekte/neu");
  assert.equal(
    getLocalizedPathname("/projects/123/settings/setup", "cs"),
    "/cs/projekty/123/nastaveni/konfigurace"
  );
  assert.equal(
    getLocalizedPathname("/projects/123/settings/setup", "es"),
    "/es/proyectos/123/configuracion/instalacion"
  );
  assert.equal(getLocalizedPathname("/subscription/overview", "sk"), "/sk/predplatne/suhrn");
});

test("keeps localized route segment mappings unambiguous", () => {
  assert.equal(
    toInternalPath("/cs/projekty/123/nastaveni/konfigurace"),
    "/projekte/123/einstellungen/setup"
  );
  assert.equal(
    toInternalPath("/es/proyectos/123/configuracion/instalacion"),
    "/projekte/123/einstellungen/setup"
  );
  assert.equal(toInternalPath("/sk/prehlad"), "/dashboard");
  assert.equal(toInternalPath("/sk/predplatne/suhrn"), "/abonnement/uebersicht");
});

test("does not throw for malformed percent-encoded path segments", () => {
  assert.equal(toInternalPath("/de/%E0%A4%A"), "/%E0%A4%A");
  assert.equal(toCanonicalExternalPath("/de/%E0%A4%A"), "/%E0%A4%A");
});

test("returns legacy redirects for moved german routes", () => {
  assert.equal(getLegacyPublicRedirect("/preise"), "/de/preise");
  assert.equal(getLegacyPublicRedirect("/anmelden"), "/de/anmelden");
  assert.equal(getLegacyPublicRedirect("/registrieren"), "/de/registrieren");
  assert.equal(getLegacyPublicRedirect("/projekte/neu"), "/de/projekte/neu");
  assert.equal(getLegacyPublicRedirect("/de/projects/new"), "/de/projekte/neu");
  assert.equal(getLegacyPublicRedirect("/fr/projects/new"), "/fr/projets/nouveau");
  assert.equal(getLegacyPublicRedirect("/pricing"), null);
  assert.equal(getLegacyPublicRedirect("/de"), null);
  assert.equal(getLegacyPublicRedirect("/fr"), null);
});
