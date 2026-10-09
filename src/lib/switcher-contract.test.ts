import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalSwitcherConfig, normalizeSwitcherConfigLanguages, sameSwitcherConfig, switcherConfigHash, switcherConfigSchema, validateSwitcherLanguages } from "./switcher-contract";

const fixtures = JSON.parse(readFileSync("tests/fixtures/switcher-contract.json", "utf8"));

test("switcher v1 canonical hash matches PHP fixtures across key order and Unicode", () => {
  const first = switcherConfigSchema.parse(fixtures.first);
  const reordered = switcherConfigSchema.parse(fixtures.reordered);
  const emptyMaps = switcherConfigSchema.parse(fixtures.emptyMaps);
  assert.equal(switcherConfigHash(first), "f3265fea4068b3eb8d5ed3fb5a71b4c677014fff56071630d9468973c758e250");
  assert.equal(switcherConfigHash(reordered), switcherConfigHash(first));
  assert.equal(switcherConfigHash(emptyMaps), "634f5604bc541841ea88e3f4946580e4f12ff247897d2de2ea46c883276b66a8");
  assert.equal(switcherConfigHash(switcherConfigSchema.parse(fixtures.unicodeSeparators)), "21be0b82e93c8f9a72c4b43ffe8e259c66ac8b53085bf40d1f241b4351565562");
  assert.equal(sameSwitcherConfig(first, reordered), true);
  assert.notEqual(canonicalSwitcherConfig(first), canonicalSwitcherConfig(emptyMaps));
});

test("rejects names WordPress would alter while sanitizing", () => {
  for (const name of ["x%20y", "Line\nBreak"]) {
    const changed = structuredClone(fixtures.first);
    changed.instances[0].name = name;
    assert.equal(switcherConfigSchema.safeParse(changed).success, false);
    changed.instances[0].name = "Valid";
    changed.instances[0].customNames.en = name;
    assert.equal(switcherConfigSchema.safeParse(changed).success, false);
  }
});

test("switcher validation refuses unsafe selectors, flags, CSS and unknown languages", () => {
  assert.equal(validateSwitcherLanguages(switcherConfigSchema.parse(fixtures.first), ["de", "en"]), true);
  assert.equal(validateSwitcherLanguages(switcherConfigSchema.parse(fixtures.first), ["de"]), false);
  const changed = structuredClone(fixtures.first);
  changed.instances[0].selector = "body:has(script)";
  assert.equal(switcherConfigSchema.safeParse(changed).success, false);
  changed.instances[0].selector = "#site-header";
  changed.instances[0].customFlags.en = "x\";color:red";
  assert.equal(switcherConfigSchema.safeParse(changed).success, false);
  changed.instances[0].customFlags.en = "🇺🇸";
  changed.instances[0].customCss = "</style><script>";
  assert.equal(switcherConfigSchema.safeParse(changed).success, false);
});

test("selector validation agrees with WordPress on compounds and unsafe targets", () => {
  for (const value of ["#123", "script", "head > nav"]) {
    const changed = structuredClone(fixtures.first);
    changed.instances[0].selector = value;
    assert.equal(switcherConfigSchema.safeParse(changed).success, false, value);
  }
  for (const value of [".menu.primary", "#site-header > nav.primary"]) {
    const changed = structuredClone(fixtures.first);
    changed.instances[0].selector = value;
    assert.equal(switcherConfigSchema.safeParse(changed).success, true, value);
  }
});

test("existing WordPress instance IDs remain valid in the SaaS contract", () => {
  for (const id of ["header_main", "_header"]) {
    const changed = structuredClone(fixtures.first);
    changed.instances.push({ ...structuredClone(changed.instances[0]), id });
    assert.equal(switcherConfigSchema.safeParse(changed).success, true, id);
  }
});

test("preserves supported three-letter project languages", () => {
  const withThreeLetterLanguage = structuredClone(fixtures.first);
  withThreeLetterLanguage.instances[0].languageOrder = ["de", "fil", "haw"];
  withThreeLetterLanguage.instances[0].customNames = { fil: "Filipino", haw: "ʻŌlelo Hawaiʻi" };
  assert.equal(switcherConfigSchema.safeParse(withThreeLetterLanguage).success, true);
});

test("accepts a configured script and region target in switcher saves", () => {
  const regional = structuredClone(fixtures.first);
  regional.instances[0].languageOrder = ["de", "zh-hant-tw"];
  regional.instances[0].customNames = { "zh-hant-tw": "Traditional Chinese" };
  regional.instances[0].customFlags = { "zh-hant-tw": "🇹🇼" };
  const parsed = switcherConfigSchema.parse(regional);
  assert.equal(validateSwitcherLanguages(parsed, ["de", "zh-hant-tw"]), true);
});

test("accepts the enterprise maximum of 50 targets plus source language", () => {
  const enterprise = structuredClone(fixtures.first);
  const targets = Array.from({ length: 50 }, (_, index) => `x${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + index % 26)}`);
  enterprise.instances[0].languageOrder = ["de", ...targets];
  assert.equal(switcherConfigSchema.safeParse(enterprise).success, true);
});

test("editing after removing a language preserves active overrides and permits save", () => {
  const existing = structuredClone(fixtures.first);
  existing.instances[0].languageOrder = ["de", "en", "fr"];
  existing.instances[0].customNames.fr = "Français";
  existing.instances[0].customFlags.fr = "🇫🇷";
  const normalized = normalizeSwitcherConfigLanguages(switcherConfigSchema.parse(existing), ["de", "en"]);
  assert.deepEqual(normalized.instances[0].languageOrder, ["de", "en"]);
  assert.deepEqual(normalized.instances[0].customNames, { de: "Österreichisches Deutsch", en: "English" });
  assert.deepEqual(normalized.instances[0].customFlags, { de: "🇦🇹", en: "🇺🇸" });
  assert.equal(validateSwitcherLanguages(normalized, ["de", "en"]), true);
});
