import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildPluginOwnedSettingsUpdate,
  buildRuntimeSyncMirrorRecord,
  canonicalHost,
  findPluginMirrorConflicts,
  hasRuntimeSyncDomainConflict,
  type PluginSettingsSyncPayload,
  validatePluginDomainMappings,
} from "@/lib/plugin-settings-sync";

const basePayload: PluginSettingsSyncPayload = {
  routingMode: "SUBDOMAIN",
  siteUrl: "https://example.com",
  sourceLanguage: "de",
  targetLanguages: ["en", "fr"],
  autoRedirect: false,
  translateEmails: false,
  translateSearch: false,
  translateAmp: false,
  domainMappings: [{ langCode: "en", host: "en.example.com" }],
};

test("accepts partial subdomain mappings for path-prefix fallback languages", () => {
  assert.equal(validatePluginDomainMappings(basePayload), null);
});

test("still rejects duplicate hosts and mappings for inactive languages", () => {
  assert.notEqual(validatePluginDomainMappings({
    ...basePayload,
    domainMappings: [
      { langCode: "en", host: "shared.example.com" },
      { langCode: "fr", host: "shared.example.com" },
    ],
  }), null);

  assert.notEqual(validatePluginDomainMappings({
    ...basePayload,
    domainMappings: [{ langCode: "it", host: "it.example.com" }],
  }), null);
});

test("keeps plugin-owned writes separate from SaaS-owned general settings", () => {
  const update = buildPluginOwnedSettingsUpdate({
    ...basePayload,
    autoRedirect: true,
    translateEmails: true,
    translateSearch: true,
    translateAmp: true,
  }, new Date("2026-08-25T12:00:00.000Z"));

  assert.deepEqual(update, {
    translateEmails: true,
    translateSearch: true,
    translateAmp: true,
    routingMode: "SUBDOMAIN",
    runtimeSyncedAt: new Date("2026-08-25T12:00:00.000Z"),
  });
  assert.equal("autoSwitch" in update, false);
  assert.equal("automaticTranslation" in update, false);
  assert.equal("displayAiNotice" in update, false);
});

test("reports mirrored WordPress drift while keeping the SaaS values authoritative", () => {
  assert.deepEqual(
    findPluginMirrorConflicts(basePayload, {
      domain: "canonical.example.com",
      sourceLanguage: "en",
      targetLanguages: ["de", "fr"],
      autoRedirect: true,
    }),
    ["domain", "sourceLanguage", "targetLanguages", "autoRedirect"],
  );

  assert.deepEqual(
    findPluginMirrorConflicts(basePayload, {
      domain: "example.com",
      sourceLanguage: "de",
      targetLanguages: ["fr", "en"],
      autoRedirect: false,
    }),
    [],
  );
});

test("the plugin sync route never writes SaaS-owned project or language rows", () => {
  const source = readFileSync(
    "src/app/api/plugin/settings-sync/route.ts",
    "utf8",
  );

  assert.match(source, /buildPluginOwnedSettingsUpdate\(/);
  assert.doesNotMatch(source, /tx\.project\.update\(/);
  assert.doesNotMatch(source, /tx\.projectLanguage\.(?:create|createMany|update|updateMany|delete)/);
});

test("the plugin sync response selects only safe settings and never provider ciphertext", () => {
  const source = readFileSync(
    "src/app/api/plugin/settings-sync/route.ts",
    "utf8",
  );

  assert.doesNotMatch(source, /settings:\s*true/);
  assert.doesNotMatch(source, /translationApiKeyEncrypted/);
  assert.match(source, /settings:\s*\{\s*select:/);
  assert.match(source, /translateEmails:\s*true/);
  assert.match(source, /runtimeSyncedAt:\s*true/);
});

test("records the reporting host and conflicts of the last plugin sync", () => {
  assert.deepEqual(
    buildRuntimeSyncMirrorRecord(
      { ...basePayload, siteUrl: "https://www.jobspot.at/" },
      ["domain"],
    ),
    { runtimeSyncSiteHost: "www.jobspot.at", runtimeSyncConflicts: ["domain"] },
  );
  assert.deepEqual(
    buildRuntimeSyncMirrorRecord({ ...basePayload, siteUrl: undefined }, []),
    { runtimeSyncSiteHost: null, runtimeSyncConflicts: [] },
  );
});

test("canonicalHost reduces stored domains and site URLs to a comparable hostname", () => {
  assert.equal(canonicalHost("https://Example.com/"), "example.com");
  assert.equal(canonicalHost("HTTP://www.example.com/path?x=1"), "example.com");
  assert.equal(canonicalHost("www.example.com"), "example.com");
  assert.equal(canonicalHost("example.com:8443"), "example.com:8443");
  assert.equal(canonicalHost("https://example.com:443/"), "example.com");
  assert.equal(canonicalHost("https://example.com./"), "example.com");
  assert.equal(canonicalHost("www.example.com.:8443"), "example.com:8443");
  assert.equal(canonicalHost("  "), null);
  assert.equal(canonicalHost(null), null);
});

test("the domain warning compares the reported host with the current domain", () => {
  assert.equal(hasRuntimeSyncDomainConflict("www.meinhaushalt.at", "www.jobspot.at"), true);
  assert.equal(hasRuntimeSyncDomainConflict("www.meinhaushalt.at", "meinhaushalt.at"), false);
  assert.equal(hasRuntimeSyncDomainConflict("https://example.com", "example.com"), false);
  assert.equal(hasRuntimeSyncDomainConflict("www.jobspot.at", "www.jobspot.at"), false);
  assert.equal(hasRuntimeSyncDomainConflict("example.com:8443", "example.com:9443"), true);
  assert.equal(hasRuntimeSyncDomainConflict("www.meinhaushalt.at", null), false);
  assert.equal(hasRuntimeSyncDomainConflict(undefined, undefined), false);
});

test("mirror conflicts ignore scheme and www differences in the stored domain", () => {
  assert.deepEqual(
    findPluginMirrorConflicts(
      { ...basePayload, siteUrl: "https://www.example.com" },
      {
        domain: "https://example.com",
        sourceLanguage: "de",
        targetLanguages: ["en", "fr"],
        autoRedirect: false,
      },
    ),
    [],
  );
});

test("the plugin sync route persists the mirror record and every settings page surfaces it", () => {
  const route = readFileSync(
    "src/app/api/plugin/settings-sync/route.ts",
    "utf8",
  );
  assert.match(route, /buildRuntimeSyncMirrorRecord\(body, mirrorConflicts\)/);
  // The reporting host is stored before domain-mapping validation can reject
  // the payload, and again best-effort when the transaction rolls back.
  assert.ok(
    route.indexOf("runtimeSyncApiKeyId: apiKey.id") <
      route.indexOf("validatePluginDomainMappings("),
    "sync origin must be recorded before validation",
  );
  assert.ok(
    route.indexOf("lockProjectRuntimeConfiguration(tx, projectId)") <
      route.indexOf("tx.apiKey.findFirst(") &&
      route.indexOf("tx.apiKey.findFirst(") <
        route.indexOf("runtimeSyncApiKeyId: apiKey.id"),
    "the key must be re-validated under the lock before the origin is written",
  );
  assert.match(route, /error\.code === "P2002"[\s\S]*runtimeSyncSiteHost: getSourceHost\(body\)/);
  assert.match(route, /error\.code === "P2002"[\s\S]*projectSettings\s*\.upsert\(/);

  const revoke = readFileSync(
    "src/app/api/projects/[projektId]/api-keys/[apiKeyId]/route.ts",
    "utf8",
  );
  assert.match(revoke, /runtimeSyncApiKeyId: apiKey\.id/);
  assert.match(revoke, /CLEARED_RUNTIME_SYNC_ORIGIN/);
  assert.match(revoke, /\$transaction\(\[[\s\S]*apiKey\.delete\([\s\S]*projectSettings\.updateMany\(/);

  const dismiss = readFileSync(
    "src/app/api/projects/[projektId]/runtime-sync-origin/route.ts",
    "utf8",
  );
  assert.match(dismiss, /userCanManageProject\(/);
  assert.match(dismiss, /CLEARED_RUNTIME_SYNC_ORIGIN/);

  const banner = readFileSync(
    "src/components/projekte/runtime-sync-banner.tsx",
    "utf8",
  );
  assert.match(banner, /hasRuntimeSyncDomainConflict\(/);
  assert.match(banner, /role="alert"/);

  for (const page of [
    "src/app/(dashboard)/projekte/[projektId]/einstellungen/page.tsx",
    "src/app/(dashboard)/projekte/[projektId]/einstellungen/wordpress/page.tsx",
    "src/app/(dashboard)/projekte/[projektId]/einstellungen/switcher/page.tsx",
  ]) {
    const source = readFileSync(page, "utf8");
    assert.match(source, /syncSiteHost=\{/, page);
    assert.match(source, /projectId=\{projektId\}/, page);
  }
});
