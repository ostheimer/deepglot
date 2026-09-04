import assert from "node:assert/strict";
import { after, test } from "node:test";

import type { NextRequest } from "next/server";

import { resolveDatabaseUrl } from "@/lib/database-url";
import {
  PLUGIN_RATE_LIMIT_SCOPE,
  hashRateLimitSubject,
} from "@/lib/rate-limit";

const databaseUrl = resolveDatabaseUrl();
const skipWithoutDatabase = databaseUrl
  ? false
  : "requires a prepared PostgreSQL database via DATABASE_URL or DEEPGLOT_DATABASE_URL";
const cleanupOrganizationIds = new Set<string>();
const cleanupApiKeyIds = new Set<string>();

function runtimeRequest(apiKey: string): NextRequest {
  return new Request(
    "https://deepglot.example.test/api/plugin/runtime-config",
    {
      headers: { authorization: `Bearer ${apiKey}` },
    },
  ) as NextRequest;
}

function settingsSyncRequest(
  apiKey: string,
  targetLanguages: string[],
  changedHost: string,
): NextRequest {
  return new Request("https://deepglot.example.test/api/plugin/settings-sync", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      routingMode: "SUBDOMAIN",
      siteUrl: `https://${changedHost}`,
      sourceLanguage: "it",
      targetLanguages,
      autoRedirect: true,
      translateEmails: true,
      translateSearch: true,
      translateAmp: true,
      domainMappings: [
        {
          langCode: targetLanguages[0],
          host: `translated.${changedHost}`,
        },
      ],
    }),
  }) as NextRequest;
}

test(
  "WordPress settings sync preserves SaaS-owned languages even when dormant mappings would overflow runtime",
  { skip: skipWithoutDatabase, timeout: 30_000 },
  async () => {
    const [{ db }, { generateApiKey }, settingsSync, runtime, limits] =
      await Promise.all([
        import("@/lib/db"),
        import("@/lib/api-keys"),
        import("@/app/api/plugin/settings-sync/route"),
        import("@/app/api/plugin/runtime-config/route"),
        import("@/lib/media-runtime-limits"),
      ]);
    const suffix = crypto.randomUUID();
    const originalDomain = `initial-${suffix}.example.test`;
    const originalMappedHost = `en-${suffix}.example.test`;
    const changedDomain = `changed-${suffix}.example.test`;
    const organization = await db.organization.create({
      data: {
        name: `Plugin settings runtime ${suffix}`,
        slug: `plugin-settings-runtime-${suffix}`,
      },
    });
    cleanupOrganizationIds.add(organization.id);

    const project = await db.project.create({
      data: {
        name: "Plugin settings image-runtime isolation",
        domain: originalDomain,
        originalLang: "de",
        organizationId: organization.id,
        languages: {
          create: [
            { langCode: "en", isActive: true },
            { langCode: "fr", isActive: false },
          ],
        },
        settings: { create: { autoSwitch: false, routingMode: "PATH_PREFIX" } },
        domainMappings: {
          create: { langCode: "en", host: originalMappedHost },
        },
      },
    });

    const longMapping = (index: number, langTo: string) => ({
      projectId: project.id,
      langTo,
      originalUrl: `/uploads/${index}-${"a".repeat(990)}.png`,
      localizedUrl: `/uploads/${index}-${"b".repeat(990)}.webp`,
    });
    await db.projectMediaReplacement.createMany({
      data: [
        ...Array.from({ length: 113 }, (_, index) => longMapping(index, "en")),
        longMapping(999, "fr"),
      ],
    });

    const { rawKey, apiKey } = await generateApiKey({
      projectId: project.id,
      name: "Integration-only bounded plugin settings key",
    });
    cleanupApiKeyIds.add(apiKey.id);

    const initialRuntime = await runtime.GET(runtimeRequest(rawKey));
    assert.equal(initialRuntime.status, 200);
    assert.ok(
      new TextEncoder().encode(
        JSON.stringify((await initialRuntime.json()).mediaReplacements),
      ).byteLength < limits.MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES,
    );

    const synced = await settingsSync.POST(
      settingsSyncRequest(rawKey, ["en", "fr"], changedDomain),
    );
    assert.equal(synced.status, 200);

    const preserved = await db.project.findUniqueOrThrow({
      where: { id: project.id },
      include: {
        languages: { orderBy: { langCode: "asc" } },
        settings: true,
        domainMappings: true,
      },
    });
    assert.equal(preserved.domain, originalDomain);
    assert.equal(preserved.originalLang, "de");
    assert.deepEqual(
      preserved.languages.map(({ langCode, isActive }) => ({
        langCode,
        isActive,
      })),
      [
        { langCode: "en", isActive: true },
        { langCode: "fr", isActive: false },
      ],
    );
    assert.equal(preserved.settings?.autoSwitch, false);
    assert.equal(preserved.settings?.routingMode, "SUBDOMAIN");
    assert.ok(preserved.settings?.runtimeSyncedAt instanceof Date);
    assert.deepEqual(
      preserved.domainMappings.map(({ host }) => host),
      [`translated.${changedDomain}`],
    );

    const preservedRuntime = await runtime.GET(runtimeRequest(rawKey));
    assert.equal(preservedRuntime.status, 200);
    assert.deepEqual(
      Object.keys((await preservedRuntime.json()).mediaReplacements),
      ["en"],
    );
  },
);

test(
  "WordPress settings sync cannot activate or repair a SaaS-owned legacy image-count overflow",
  { skip: skipWithoutDatabase, timeout: 30_000 },
  async () => {
    const [{ db }, { generateApiKey }, settingsSync, runtime] =
      await Promise.all([
        import("@/lib/db"),
        import("@/lib/api-keys"),
        import("@/app/api/plugin/settings-sync/route"),
        import("@/app/api/plugin/runtime-config/route"),
      ]);
    const suffix = crypto.randomUUID();
    const domain = `count-${suffix}.example.test`;
    const organization = await db.organization.create({
      data: {
        name: `Plugin settings count ${suffix}`,
        slug: `plugin-settings-count-${suffix}`,
      },
    });
    cleanupOrganizationIds.add(organization.id);
    const project = await db.project.create({
      data: {
        name: "Plugin settings image-count isolation",
        domain,
        originalLang: "de",
        organizationId: organization.id,
        languages: {
          create: [
            { langCode: "en", isActive: true },
            { langCode: "fr", isActive: false },
          ],
        },
      },
    });
    await db.projectMediaReplacement.createMany({
      data: [
        ...Array.from({ length: 500 }, (_, index) => ({
          projectId: project.id,
          langTo: "en",
          originalUrl: `/uploads/${index}.png`,
          localizedUrl: `/uploads/${index}-en.webp`,
        })),
        {
          projectId: project.id,
          langTo: "fr",
          originalUrl: "/uploads/fr.png",
          localizedUrl: "/uploads/fr.webp",
        },
      ],
    });
    const { rawKey, apiKey } = await generateApiKey({
      projectId: project.id,
      name: "Integration-only plugin settings image count key",
    });
    cleanupApiKeyIds.add(apiKey.id);

    assert.equal((await runtime.GET(runtimeRequest(rawKey))).status, 200);
    const synced = await settingsSync.POST(
      settingsSyncRequest(rawKey, ["en", "fr"], domain),
    );
    assert.equal(synced.status, 200);
    const dormant = await db.projectLanguage.findUniqueOrThrow({
      where: { projectId_langCode: { projectId: project.id, langCode: "fr" } },
    });
    assert.equal(dormant.isActive, false);
    assert.equal((await runtime.GET(runtimeRequest(rawKey))).status, 200);

    await db.projectLanguage.update({
      where: { projectId_langCode: { projectId: project.id, langCode: "fr" } },
      data: { isActive: true },
    });
    assert.equal((await runtime.GET(runtimeRequest(rawKey))).status, 413);

    const unchanged = await settingsSync.POST(
      settingsSyncRequest(rawKey, ["fr"], domain),
    );
    assert.equal(unchanged.status, 200);
    assert.equal(
      (
        await db.projectLanguage.findUniqueOrThrow({
          where: {
            projectId_langCode: { projectId: project.id, langCode: "en" },
          },
        })
      ).isActive,
      true,
    );
    assert.equal((await runtime.GET(runtimeRequest(rawKey))).status, 413);
  },
);

after(async () => {
  if (!databaseUrl || cleanupOrganizationIds.size === 0) {
    return;
  }

  const { db } = await import("@/lib/db");
  await db.rateLimitBucket.deleteMany({
    where: {
      scope: PLUGIN_RATE_LIMIT_SCOPE,
      subjectHash: {
        in: [...cleanupApiKeyIds].map((apiKeyId) =>
          hashRateLimitSubject(PLUGIN_RATE_LIMIT_SCOPE, apiKeyId),
        ),
      },
    },
  });
  await db.organization.deleteMany({
    where: { id: { in: [...cleanupOrganizationIds] } },
  });
  await db.$disconnect();
});
