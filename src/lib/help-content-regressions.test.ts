import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { isBilingualPublicLocale } from "@/lib/bilingual-public-content";
import { SITE_LOCALES } from "@/lib/site-locale";

const root = process.cwd();

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("the dedicated help surface covers the weekly digest contract", () => {
  const help = source("src/components/marketing/help-page.tsx");

  for (const phrase of [
    "opt-in email per user and workspace",
    "previous complete UTC week",
    "No activity means no email",
    "Atomic period claims prevent duplicate emails",
    "projects available through their workspace or project membership",
  ]) {
    assert.match(help, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(help, /Praktische Hinweise zu Workspace-Aktivität/);
  assert.match(help, /Ruhige Wochen bleiben ruhig/);
});

test("help, developer docs, and product copy describe every requested release", () => {
  const help = source("src/components/marketing/help-page.tsx");
  const docs = source("src/components/marketing/developer-docs.tsx");
  const home = source("src/components/marketing/marketing-home.tsx");
  const readme = source("wordpress-plugin/deepglot/readme.txt");

  for (const version of ["v0.11.4", "v0.11.5", "v0.11.6", "v0.11.7", "v0.12.1"]) {
    const escapedVersion = version.replaceAll(".", "\\.");
    assert.match(help, new RegExp(escapedVersion));
    assert.match(docs, new RegExp(escapedVersion));
    assert.match(readme, new RegExp(`(?:v)?${escapedVersion.slice(1)}`));
  }
  assert.match(docs, /weekly digest|Wochenrückblick/);
  assert.match(home, /weekly digest|Wochenrückblick/);
  assert.match(home, /background|Hintergrund/);
});

test("public copy keeps visible German umlauts and the updated translation visual", () => {
  const nav = source("src/components/marketing/marketing-nav.tsx");
  const footer = source("src/components/marketing/marketing-footer.tsx");
  const hero = source("src/components/marketing/hero-language-preview.tsx");

  assert.match(nav, /Hilfe/);
  assert.match(footer, /Hilfe/);
  assert.match(hero, /lokalen Übersetzungs-Cache/);
  assert.doesNotMatch(nav, /Hilfeseite/);
});

test("bilingual help discovery stays off unsupported marketing locales", () => {
  assert.deepEqual(SITE_LOCALES.filter(isBilingualPublicLocale), ["en", "de"]);

  for (const relativePath of [
    "src/components/marketing/marketing-home.tsx",
    "src/components/marketing/marketing-nav.tsx",
    "src/components/marketing/marketing-footer.tsx",
  ]) {
    assert.match(
      source(relativePath),
      /isBilingualPublicLocale\(locale\)/,
      `${relativePath} must not expose English-only help discovery on other localized pages`
    );
  }
});
