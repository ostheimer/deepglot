import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildPluginOwnedSettingsUpdate,
  buildPluginMirrorStatusUpdate,
  findPluginMirrorConflicts,
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

test("persists a reported WordPress host when it conflicts with the project domain", () => {
  const syncedAt = new Date("2026-09-15T08:00:00.000Z");

  assert.deepEqual(
    buildPluginMirrorStatusUpdate(
      { ...basePayload, siteUrl: "https://WWW.jobspot.at/wordpress" },
      ["domain"],
      syncedAt,
    ),
    {
      runtimeDomainConflictHost: "www.jobspot.at",
      runtimeDomainConflictAt: syncedAt,
    },
  );
});

test("clears a previous domain warning only after a matching host is reported", () => {
  const syncedAt = new Date("2026-09-15T08:00:00.000Z");

  assert.deepEqual(
    buildPluginMirrorStatusUpdate(basePayload, [], syncedAt),
    {
      runtimeDomainConflictHost: null,
      runtimeDomainConflictAt: null,
    },
  );
  assert.deepEqual(
    buildPluginMirrorStatusUpdate(
      { ...basePayload, siteUrl: undefined },
      [],
      syncedAt,
    ),
    {},
  );
});
