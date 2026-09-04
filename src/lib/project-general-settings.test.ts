import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  INDUSTRY_TYPES,
  SOURCE_LANGUAGE_MIGRATION_COPY,
  WEBSITE_TYPES,
  buildProjectRuntimeSettings,
  getProjectGeneralSettings,
  normalizeProjectDomain,
  planOriginalLanguageChange,
  projectGeneralSettingsPatchSchema,
} from "@/lib/project-general-settings";

const version = "2026-08-25T12:00:00.000Z";

test("normalizes a complete project settings update to canonical values", () => {
  const parsed = projectGeneralSettingsPatchSchema.parse({
    expectedVersion: version,
    name: "  Deepglot Docs  ",
    domain: "https://Docs.Example.test/",
    sourceLanguage: " EN ",
    autoRedirect: true,
    displayAiNotice: true,
    automaticTranslation: false,
    websiteType: "Corporate website",
    industryType: "Software & technology",
  });

  assert.deepEqual(parsed, {
    expectedVersion: version,
    name: "Deepglot Docs",
    domain: "docs.example.test",
    originalLang: "en",
    autoSwitch: true,
    displayAiNotice: true,
    automaticTranslation: false,
    websiteType: "Corporate website",
    industryType: "Software & technology",
  });
});

test("normalizes equivalent revision timestamps before optimistic comparison", () => {
  const parsed = projectGeneralSettingsPatchSchema.parse({
    expectedVersion: "2026-08-25T14:00:00.000+02:00",
    name: "Deepglot Docs",
  });

  assert.equal(parsed.expectedVersion, version);
});

test("preserves the existing one-character project-name contract", () => {
  assert.equal(
    projectGeneralSettingsPatchSchema.parse({
      expectedVersion: version,
      name: " X ",
    }).name,
    "X",
  );
  assert.equal(
    projectGeneralSettingsPatchSchema.safeParse({
      expectedVersion: version,
      name: "   ",
    }).success,
    false,
  );
});

test("accepts host and localhost domains with an explicit port", () => {
  assert.equal(normalizeProjectDomain("localhost:3100"), "localhost:3100");
  assert.equal(normalizeProjectDomain("Example.COM:8080"), "example.com:8080");
  assert.equal(
    normalizeProjectDomain("http://localhost:3100/"),
    "localhost:3100",
  );
});

test("rejects unsafe domains, unsupported languages, unknown choices and empty patches", () => {
  for (const domain of [
    "https://user:secret@example.test",
    "https://example.test/path",
    "https://example.test/?secret=1",
    "javascript:alert(1)",
    "not a host",
  ]) {
    assert.throws(
      () => normalizeProjectDomain(domain),
      { name: "Error" },
      domain,
    );
  }

  for (const patch of [
    { expectedVersion: version },
    { expectedVersion: version, sourceLanguage: "xx" },
    { expectedVersion: version, originalLang: "en" },
    { expectedVersion: version, autoSwitch: true },
    { expectedVersion: version, websiteType: "Unknown type" },
    { expectedVersion: version, industryType: "Unknown industry" },
    { name: "Missing revision" },
  ]) {
    assert.equal(
      projectGeneralSettingsPatchSchema.safeParse(patch).success,
      false,
      JSON.stringify(patch),
    );
  }

  assert.ok(WEBSITE_TYPES.includes("Blog"));
  assert.ok(INDUSTRY_TYPES.includes("Health & medical"));
});

test("plans a safe source-language swap only before dependent content exists", () => {
  assert.deepEqual(
    planOriginalLanguageChange({
      currentLanguage: "de",
      nextLanguage: "en",
      hasLanguageDependentContent: false,
    }),
    {
      kind: "migrate",
      activateTargetLanguage: "de",
      deactivateTargetLanguage: "en",
      removeDomainMappingLanguage: "en",
    },
  );

  assert.deepEqual(
    planOriginalLanguageChange({
      currentLanguage: "de",
      nextLanguage: "en",
      hasLanguageDependentContent: true,
    }),
    { kind: "locked" },
  );

  assert.deepEqual(
    planOriginalLanguageChange({
      currentLanguage: "de",
      nextLanguage: "de",
      hasLanguageDependentContent: true,
    }),
    { kind: "unchanged" },
  );
});

test("expired language invitations do not lock a source-language change", async () => {
  let invitationWhere: Record<string, unknown> | undefined;
  const zeroCount = async () => 0;
  const database = {
    project: { findUnique: async () => null },
    translation: { count: zeroCount },
    glossaryRule: { count: zeroCount },
    urlSlug: { count: zeroCount },
    translatedUrl: { count: zeroCount },
    projectMediaReplacement: { count: zeroCount },
    projectMember: { count: zeroCount },
    projectInvitation: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        invitationWhere = where;
        return 0;
      },
    },
  };

  await getProjectGeneralSettings(database as never, "project-1");

  const expiry = invitationWhere?.expiresAt as { gt?: unknown } | undefined;
  assert.ok(
    expiry?.gt instanceof Date,
    "only unexpired pending invitations may be included in the language lock",
  );
});

test("documents every source-language routing migration effect in dashboard copy", () => {
  assert.equal(
    SOURCE_LANGUAGE_MIGRATION_COPY.en,
    "You can only choose an active target language as the new original language. The languages are swapped: the previous original language becomes an active target, the selected target is deactivated, and its domain mapping is removed.",
  );
  assert.equal(
    SOURCE_LANGUAGE_MIGRATION_COPY.de,
    "Als neue Originalsprache kannst du nur eine aktive Zielsprache wählen. Die Sprachen werden getauscht: Die bisherige Originalsprache wird als Ziel aktiviert, die gewählte Zielsprache deaktiviert und ihre Domain-Zuordnung entfernt.",
  );
});

test("the source-language picker only offers the current source and active targets", () => {
  const source = readFileSync(
    "src/components/projekte/project-general-settings-form.tsx",
    "utf8",
  );

  assert.doesNotMatch(source, /SUPPORTED_TRANSLATION_LANGUAGES/);
  assert.match(source, /settings\.targetLanguages/);

  const picker = source.slice(
    source.indexOf("const sourceLanguages = useMemo"),
    source.indexOf("const savedWebsiteUrl = useMemo"),
  );
  assert.match(picker, /baseline\.sourceLanguage/);
  assert.match(picker, /code === baseline\.sourceLanguage/);
});

test("serializes one authoritative shape for the dashboard and plugin readback", () => {
  assert.deepEqual(
    buildProjectRuntimeSettings({
      name: "Docs",
      domain: "docs.example.test",
      originalLang: "de",
      updatedAt: new Date(version),
      languages: [
        { langCode: "fr", isActive: false },
        { langCode: "en", isActive: true },
        { langCode: "it", isActive: true },
      ],
      settings: null,
    }),
    {
      version,
      name: "Docs",
      domain: "docs.example.test",
      sourceLanguage: "de",
      targetLanguages: ["en", "it"],
      autoRedirect: false,
      displayAiNotice: false,
      automaticTranslation: true,
      websiteType: null,
      industryType: null,
    },
  );
});

test("the authenticated runtime endpoint independently exposes the authoritative project shape", () => {
  const source = readFileSync(
    "src/app/api/plugin/runtime-config/route.ts",
    "utf8",
  );

  assert.match(source, /buildProjectRuntimeSettings\(/);
  assert.match(source, /project:\s*buildProjectRuntimeSettings/);
});
