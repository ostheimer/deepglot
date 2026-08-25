import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DASHBOARD_DEVELOPER_SURFACES,
  PROBLEM_DETAILS_EXAMPLE,
  PROJECT_WEBHOOK_DOC_EVENTS,
  PUBLIC_ENDPOINT_DOCS,
  WORDPRESS_REST_ENDPOINTS,
} from "@/lib/public-docs";
import { PROJECT_WEBHOOK_EVENT_TYPES } from "@/lib/webhooks";

const root = process.cwd();

test("documents every public and plugin SaaS endpoint with a real source file", () => {
  const expected = [
    "/api/translate",
    "/api/public/status",
    "/api/public/languages",
    "/api/public/languages/is-supported?languageFrom=de&languageTo=en",
    "/api/plugin/runtime-config",
    "/api/plugin/settings-sync",
  ];

  assert.deepEqual(PUBLIC_ENDPOINT_DOCS.map((endpoint) => endpoint.path), expected);
  for (const endpoint of PUBLIC_ENDPOINT_DOCS) {
    assert.equal(existsSync(path.join(root, endpoint.sourceFile)), true, endpoint.sourceFile);
    assert.ok(endpoint.summary.en.length > 20);
    assert.ok(endpoint.summary.de.length > 20);
    assert.ok(endpoint.responseExample, `${endpoint.path} lacks a response example`);
  }
});

test("keeps dashboard surfaces and WordPress REST routes represented in public docs", () => {
  for (const surface of DASHBOARD_DEVELOPER_SURFACES) {
    assert.equal(existsSync(path.join(root, surface.sourceFile)), true, surface.sourceFile);
  }
  assert.ok(WORDPRESS_REST_ENDPOINTS.includes("POST /wp-json/deepglot/v1/translate-dynamic"));
  assert.ok(DASHBOARD_DEVELOPER_SURFACES.some((surface) => surface.access === "manage"));
  assert.ok(DASHBOARD_DEVELOPER_SURFACES.some((surface) => surface.access === "member"));
});

test("keeps documented webhook events in lockstep with the delivery contract", () => {
  assert.deepEqual(PROJECT_WEBHOOK_DOC_EVENTS, PROJECT_WEBHOOK_EVENT_TYPES);
});

test("documents Problem Details, quota, rate limits, auth, and idempotency behavior", () => {
  const docsSource = readFileSync(path.join(root, "src/lib/public-docs.ts"), "utf8");
  const problem = JSON.parse(PROBLEM_DETAILS_EXAMPLE);

  assert.equal(problem.status, 400);
  assert.equal(problem.code, "validation_failed");
  for (const required of [
    "Authorization: Bearer",
    "Idempotency-Key",
    "24 hours",
    "402",
    "409",
    "429",
    "Retry-After",
    "sharedAcrossProviders",
  ]) {
    assert.ok(docsSource.includes(required), `Public docs omit: ${required}`);
  }
});

test("documents bounded idempotency retention for both translate endpoint locales", () => {
  const translate = PUBLIC_ENDPOINT_DOCS.find((endpoint) => endpoint.id === "translate");
  assert.ok(translate);

  const notes = {
    en: translate.notes.map((note) => note.en).join(" "),
    de: translate.notes.map((note) => note.de).join(" "),
  };

  assert.match(notes.en, /success and deterministic responses[^.]*24 hours/i);
  assert.match(notes.en, /retryable 429[^.]*bounded Retry-After[^.]*new execution/i);
  assert.match(notes.en, /different body[^.]*409[^.]*while the record is retained/i);

  assert.match(notes.de, /erfolgreiche und deterministische Antworten[^.]*24 Stunden/i);
  assert.match(notes.de, /wiederholbare 429[^.]*begrenzten Retry-After[^.]*neu ausgeführt/i);
  assert.match(notes.de, /anderer Body[^.]*409[^.]*solange der Datensatz gespeichert ist/i);
});

test("documents the project settings source of truth and WordPress drift contract", () => {
  const translate = PUBLIC_ENDPOINT_DOCS.find(
    (endpoint) => endpoint.id === "translate",
  );
  const runtime = PUBLIC_ENDPOINT_DOCS.find(
    (endpoint) => endpoint.id === "runtime-config",
  );
  const sync = PUBLIC_ENDPOINT_DOCS.find(
    (endpoint) => endpoint.id === "settings-sync",
  );
  assert.ok(translate);
  assert.ok(runtime);
  assert.ok(sync);

  const translateExample = JSON.parse(translate.responseExample ?? "null") as {
    cache_only?: unknown;
  };
  assert.equal(translateExample.cache_only, false);
  assert.match(
    translate.notes.map((note) => note.en).join(" "),
    /cache_only[\s\S]*must not persist source-identical cache misses/i,
  );

  const runtimeExample = JSON.parse(runtime.responseExample ?? "null") as {
    project?: Record<string, unknown>;
  };
  assert.ok(runtimeExample.project);
  for (const field of [
    "version",
    "name",
    "domain",
    "sourceLanguage",
    "targetLanguages",
    "autoRedirect",
    "displayAiNotice",
    "automaticTranslation",
    "websiteType",
    "industryType",
  ]) {
    assert.ok(
      Object.hasOwn(runtimeExample.project, field),
      `runtime project block omits ${field}`,
    );
  }

  const syncExample = JSON.parse(sync.responseExample ?? "null") as {
    mirrorConflicts?: unknown;
  };
  assert.ok(Array.isArray(syncExample.mirrorConflicts));

  const ownership = {
    en: [runtime.summary.en, sync.summary.en, ...sync.notes.map((note) => note.en)].join(
      " ",
    ),
    de: [runtime.summary.de, sync.summary.de, ...sync.notes.map((note) => note.de)].join(
      " ",
    ),
  };

  for (const term of [
    "SaaS is authoritative",
    "project name",
    "source and target languages",
    "automatic redirect",
    "AI notice",
    "automatic translation",
    "website type",
    "industry context",
    "WordPress is authoritative",
    "routing mode",
    "domain mappings",
    "email, search, and AMP",
    "dynamic translation",
    "mirrorConflicts",
    "not written back",
  ]) {
    assert.match(ownership.en, new RegExp(term, "i"), `English docs omit: ${term}`);
  }

  for (const term of [
    "SaaS ist autoritativ",
    "Projektname",
    "Quell- und Zielsprachen",
    "automatische Weiterleitung",
    "KI-Hinweis",
    "automatische Übersetzung",
    "Website-Typ",
    "Branchenkontext",
    "WordPress ist autoritativ",
    "Routing-Modus",
    "Domain-Zuordnungen",
    "E-Mail, Suche und AMP",
    "dynamische Übersetzung",
    "mirrorConflicts",
    "nicht zurückgeschrieben",
  ]) {
    assert.match(ownership.de, new RegExp(term, "i"), `German docs omit: ${term}`);
  }
});
