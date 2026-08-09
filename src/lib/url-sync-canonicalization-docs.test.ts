import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("developer docs and help explain same-host HTTPS URL-sync canonicalization bilingually", () => {
  const developerDocs = source("src/components/marketing/developer-docs.tsx");
  const help = source("src/components/marketing/help-page.tsx");

  assert.match(developerDocs, /safe HTTPS request/);
  assert.match(developerDocs, /sichere HTTPS-Anfrage/);
  assert.match(help, /current safe WordPress request uses HTTPS/);
  assert.match(help, /aktuelle sichere WordPress-Anfrage über HTTPS/);

  for (const publicSurface of [developerDocs, help]) {
    assert.match(publicSurface, /same host|demselben Host/);
    assert.match(publicSurface, /Semantic query parameters and fragments are preserved/);
    assert.match(publicSurface, /Semantische Query-Parameter und Fragmente bleiben erhalten/);
    assert.match(publicSurface, /foreign request host|fremder Request-Host/i);
    assert.match(publicSurface, /redirects? remain|Weiterleitungen.*bleiben/i);
  }

  assert.match(developerDocs, /tatsächliche Weiterleitungen/);
  assert.match(help, /Prüfe vor dem Bestätigen/);
});

test("repository, operations, and plugin documentation retain the security boundary", () => {
  const documents = [
    source("README.md"),
    source("OPERATIONS.md"),
    source("wordpress-plugin/deepglot/README.md"),
    source("wordpress-plugin/deepglot/readme.txt"),
  ];

  for (const documentation of documents) {
    assert.match(documentation, /HTTPS/);
    assert.match(documentation, /same-host|same host|identical host/i);
    assert.match(
      documentation,
      /preserv(?:e|ed|es|ing).*query parameters and fragments|query parameters and fragments.*preserv(?:e|ed|es|ing)/i,
    );
    assert.match(documentation, /never cop(?:y|ies)|never copied/i);
    assert.match(documentation, /redirects? remain/i);
  }

  assert.match(documents[1], /untrusted forwarded-protocol hint/i);
  assert.match(documents[1], /does not recognize as SSL/i);
});
