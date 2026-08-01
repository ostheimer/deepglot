import assert from "node:assert/strict";
import test from "node:test";

import {
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
