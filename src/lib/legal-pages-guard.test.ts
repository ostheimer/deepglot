import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

test("public legal pages contain no pre-launch placeholder language", () => {
  const legalPages = [
    "src/app/impressum/page.tsx",
    "src/app/agb/page.tsx",
    "src/app/datenschutz/page.tsx",
  ].map(read).join("\n");

  assert.doesNotMatch(
    legalPages,
    /technical placeholder|will receive final legal review|will be finalized before|technische Platzhalter|vor dem kommerziellen Launch final|vor der Live-Schaltung[^\n]*finalisiert/i
  );
});

test("legal notice identifies the current operator and provides direct contact details", () => {
  const legalNotice = read("src/app/impressum/page.tsx");

  for (const required of [
    "Ostheimer OG",
    "ATU79912016",
    "613327b",
    "Fabriksgasse 20",
    "2230 Gänserndorf",
    "+43 699 1726 3544",
    "office@ostheimer.at",
  ]) {
    assert.ok(legalNotice.includes(required), `Missing operator detail: ${required}`);
  }
});

test("terms and privacy pages cover the product's implemented commercial and data flows", () => {
  const terms = read("src/app/agb/page.tsx");
  const privacy = read("src/app/datenschutz/page.tsx");

  for (const required of [
    "Stripe",
    "subscription",
    "quota",
    "cancel",
    "Kündigung",
    "Wortlimit",
    "self-host",
  ]) {
    assert.ok(terms.toLowerCase().includes(required.toLowerCase()), `Terms omit: ${required}`);
  }

  for (const required of [
    "Stripe",
    "Neon",
    "Vercel",
    "Cloudflare",
    "OAuth",
    "webhooks",
    "provider API",
    "export",
    "deletion",
    "Auftragsverarbeiter",
    "Rechtsgrundlage",
  ]) {
    assert.ok(privacy.toLowerCase().includes(required.toLowerCase()), `Privacy page omits: ${required}`);
  }
});

test("repository contains a legal-review checklist for billing and privacy changes", () => {
  const checklistPath = path.join(root, "docs/LEGAL-REVIEW.md");
  assert.equal(existsSync(checklistPath), true, "docs/LEGAL-REVIEW.md is missing");
  const checklist = read("docs/LEGAL-REVIEW.md");

  assert.match(checklist, /billing/i);
  assert.match(checklist, /privacy/i);
  assert.match(checklist, /legal review/i);
});
