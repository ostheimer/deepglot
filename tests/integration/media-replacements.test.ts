import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import { resolveDatabaseUrl } from "@/lib/database-url";
import { PLUGIN_RATE_LIMIT_SCOPE, hashRateLimitSubject } from "@/lib/rate-limit";

const databaseUrl = resolveDatabaseUrl();
const skipWithoutDatabase = databaseUrl
  ? false
  : "requires a prepared PostgreSQL database via DATABASE_URL or DEEPGLOT_DATABASE_URL";
const cleanupOrganizationIds = new Set<string>();
const cleanupApiKeyIds = new Set<string>();

function runtimeRequest(apiKey?: string): NextRequest {
  const headers = new Headers();
  if (apiKey) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  return new Request("https://deepglot.example.test/api/plugin/runtime-config", {
    headers,
  }) as NextRequest;
}

test(
  "PostgreSQL isolates locale-specific image mappings, enforces uniqueness, authenticates runtime configuration and cascades project deletion",
  { skip: skipWithoutDatabase },
  async () => {
    const [{ db }, { generateApiKey }, runtime] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/api-keys"),
      import("@/app/api/plugin/runtime-config/route"),
    ]);
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: { name: `Media mappings ${suffix}`, slug: `media-mappings-${suffix}` },
    });
    cleanupOrganizationIds.add(organization.id);

    const project = await db.project.create({
      data: {
        name: "Image-localization project",
        domain: `${suffix}.example.test`,
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
    const { rawKey, apiKey } = await generateApiKey({
      projectId: project.id,
      name: "Integration-only image-localization key",
    });
    cleanupApiKeyIds.add(apiKey.id);

    const originalUrl = "/wp-content/uploads/product.png";
    const englishReplacement = await db.projectMediaReplacement.create({
      data: {
        projectId: project.id,
        langTo: "en",
        originalUrl,
        localizedUrl: "/wp-content/uploads/product-en.webp?version=2",
      },
    });
    const inactiveFrenchReplacement = await db.projectMediaReplacement.create({
      data: {
        projectId: project.id,
        langTo: "fr",
        originalUrl,
        localizedUrl: "/wp-content/uploads/product-fr.avif",
      },
    });

    await assert.rejects(
      db.projectMediaReplacement.create({
        data: {
          projectId: project.id,
          langTo: "en",
          originalUrl,
          localizedUrl: "/wp-content/uploads/conflicting-en.jpg",
        },
      }),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002",
      "One project and target language must not own two replacements for the same original image"
    );

    const foreignOrganization = await db.organization.create({
      data: {
        name: `Foreign media mappings ${suffix}`,
        slug: `foreign-media-mappings-${suffix}`,
      },
    });
    cleanupOrganizationIds.add(foreignOrganization.id);
    const foreignProject = await db.project.create({
      data: {
        name: "Foreign image-localization project",
        domain: `foreign-${suffix}.example.test`,
        originalLang: "de",
        organizationId: foreignOrganization.id,
        languages: { create: [{ langCode: "en", isActive: true }] },
      },
    });
    const foreignApiKey = await generateApiKey({
      projectId: foreignProject.id,
      name: "Integration-only foreign image-localization key",
    });
    cleanupApiKeyIds.add(foreignApiKey.apiKey.id);
    const foreignReplacement = await db.projectMediaReplacement.create({
      data: {
        projectId: foreignProject.id,
        langTo: "en",
        originalUrl,
        localizedUrl: "/wp-content/uploads/foreign-product-en.gif",
      },
    });

    const unauthenticatedResponse = await runtime.GET(runtimeRequest());
    assert.equal(unauthenticatedResponse.status, 401);
    assert.equal((await unauthenticatedResponse.json()).code, "missing_api_key");

    const invalidApiKeyResponse = await runtime.GET(
      runtimeRequest("dg_live_invalid_media_key")
    );
    assert.equal(invalidApiKeyResponse.status, 401);
    assert.equal((await invalidApiKeyResponse.json()).code, "invalid_api_key");

    const englishResponse = await runtime.GET(runtimeRequest(rawKey));
    assert.equal(englishResponse.status, 200);
    const englishBody = await englishResponse.json();
    assert.deepEqual(englishBody.mediaReplacements, {
      en: {
        "/wp-content/uploads/product.png":
          "/wp-content/uploads/product-en.webp?version=2",
      },
    });
    assert.equal("fr" in englishBody.mediaReplacements, false);
    assert.equal(
      JSON.stringify(englishBody.mediaReplacements).includes(
        foreignReplacement.localizedUrl
      ),
      false,
      "A valid API key must never expose another project's image mappings"
    );
    assert.equal(
      JSON.stringify(englishBody.mediaReplacements).includes(project.id),
      false,
      "Plugin runtime mappings contain only public image paths, never tenant identifiers"
    );

    const foreignResponse = await runtime.GET(
      runtimeRequest(foreignApiKey.rawKey)
    );
    assert.equal(foreignResponse.status, 200);
    assert.deepEqual((await foreignResponse.json()).mediaReplacements, {
      en: {
        "/wp-content/uploads/product.png":
          "/wp-content/uploads/foreign-product-en.gif",
      },
    });

    await db.projectLanguage.update({
      where: {
        projectId_langCode: { projectId: project.id, langCode: "fr" },
      },
      data: { isActive: true },
    });
    const reactivatedResponse = await runtime.GET(runtimeRequest(rawKey));
    assert.equal(reactivatedResponse.status, 200);
    assert.deepEqual((await reactivatedResponse.json()).mediaReplacements, {
      en: {
        "/wp-content/uploads/product.png":
          "/wp-content/uploads/product-en.webp?version=2",
      },
      fr: {
        "/wp-content/uploads/product.png":
          "/wp-content/uploads/product-fr.avif",
      },
    });

    await db.projectLanguage.update({
      where: {
        projectId_langCode: { projectId: project.id, langCode: "en" },
      },
      data: { isActive: false },
    });
    const revokedLanguageResponse = await runtime.GET(runtimeRequest(rawKey));
    assert.equal(revokedLanguageResponse.status, 200);
    assert.deepEqual((await revokedLanguageResponse.json()).mediaReplacements, {
      fr: {
        "/wp-content/uploads/product.png":
          "/wp-content/uploads/product-fr.avif",
      },
    });

    await db.project.delete({ where: { id: project.id } });
    assert.equal(
      await db.projectMediaReplacement.count({
        where: { id: { in: [englishReplacement.id, inactiveFrenchReplacement.id] } },
      }),
      0,
      "Deleting a project must cascade to every target-language image replacement"
    );
    assert.equal(
      await db.projectMediaReplacement.count({
        where: { id: foreignReplacement.id },
      }),
      1,
      "Deleting one tenant project must not remove a foreign tenant's image mapping"
    );

    const deletedProjectResponse = await runtime.GET(runtimeRequest(rawKey));
    assert.equal(deletedProjectResponse.status, 401);
    assert.equal((await deletedProjectResponse.json()).code, "invalid_api_key");
  }
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
          hashRateLimitSubject(PLUGIN_RATE_LIMIT_SCOPE, apiKeyId)
        ),
      },
    },
  });
  await db.organization.deleteMany({
    where: { id: { in: [...cleanupOrganizationIds] } },
  });
  await db.$disconnect();
});
