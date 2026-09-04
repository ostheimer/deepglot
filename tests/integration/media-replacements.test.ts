import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Prisma } from "@prisma/client";
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

function runtimeRequest(apiKey?: string): NextRequest {
  const headers = new Headers();
  if (apiKey) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  return new Request(
    "https://deepglot.example.test/api/plugin/runtime-config",
    {
      headers,
    },
  ) as NextRequest;
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
      data: {
        name: `Media mappings ${suffix}`,
        slug: `media-mappings-${suffix}`,
      },
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
      "One project and target language must not own two replacements for the same original image",
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
    assert.equal(
      (await unauthenticatedResponse.json()).code,
      "missing_api_key",
    );

    const invalidApiKeyResponse = await runtime.GET(
      runtimeRequest("dg_live_invalid_media_key"),
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
        foreignReplacement.localizedUrl,
      ),
      false,
      "A valid API key must never expose another project's image mappings",
    );
    assert.equal(
      JSON.stringify(englishBody.mediaReplacements).includes(project.id),
      false,
      "Plugin runtime mappings contain only public image paths, never tenant identifiers",
    );

    const foreignResponse = await runtime.GET(
      runtimeRequest(foreignApiKey.rawKey),
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
        where: {
          id: { in: [englishReplacement.id, inactiveFrenchReplacement.id] },
        },
      }),
      0,
      "Deleting a project must cascade to every target-language image replacement",
    );
    assert.equal(
      await db.projectMediaReplacement.count({
        where: { id: foreignReplacement.id },
      }),
      1,
      "Deleting one tenant project must not remove a foreign tenant's image mapping",
    );

    const deletedProjectResponse = await runtime.GET(runtimeRequest(rawKey));
    assert.equal(deletedProjectResponse.status, 401);
    assert.equal((await deletedProjectResponse.json()).code, "invalid_api_key");
  },
);

test(
  "PostgreSQL rolls back oversized image writes across active languages and keeps plugin runtime available",
  { skip: skipWithoutDatabase, timeout: 30_000 },
  async () => {
    const [{ db }, { generateApiKey }, runtime, limits] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/api-keys"),
      import("@/app/api/plugin/runtime-config/route"),
      import("@/lib/media-runtime-limits"),
    ]);
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: {
        name: `Bounded media ${suffix}`,
        slug: `bounded-media-${suffix}`,
      },
    });
    cleanupOrganizationIds.add(organization.id);

    const project = await db.project.create({
      data: {
        name: "Bounded runtime image project",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        organizationId: organization.id,
        languages: {
          create: [
            { langCode: "en", isActive: true },
            { langCode: "fr", isActive: true },
            { langCode: "es", isActive: false },
          ],
        },
      },
    });
    const { rawKey, apiKey } = await generateApiKey({
      projectId: project.id,
      name: "Integration-only bounded runtime key",
    });
    cleanupApiKeyIds.add(apiKey.id);

    const longMapping = (index: number, langTo = index < 60 ? "en" : "fr") => ({
      projectId: project.id,
      langTo,
      originalUrl: `/uploads/${index}-${"a".repeat(990)}.png`,
      localizedUrl: `/uploads/${index}-${"b".repeat(990)}.webp`,
    });
    await db.projectMediaReplacement.createMany({
      data: Array.from({ length: 113 }, (_, index) => longMapping(index)),
    });
    await db.projectMediaReplacement.create({
      data: longMapping(999, "es"),
    });

    const safeRuntime = await runtime.GET(runtimeRequest(rawKey));
    assert.equal(safeRuntime.status, 200);
    const safeConfiguration = await safeRuntime.json();
    assert.deepEqual(Object.keys(safeConfiguration.mediaReplacements), [
      "en",
      "fr",
    ]);
    assert.equal("es" in safeConfiguration.mediaReplacements, false);
    assert.ok(
      new TextEncoder().encode(
        JSON.stringify(safeConfiguration.mediaReplacements),
      ).byteLength < limits.MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES,
    );

    const assertRuntimeStillAvailable = async () => {
      const response = await runtime.GET(runtimeRequest(rawKey));
      assert.equal(response.status, 200);
      const configuration = await response.json();
      assert.ok(Object.hasOwn(configuration, "exclusions"));
      assert.ok(Object.hasOwn(configuration, "urlSlugs"));
      assert.ok(Object.hasOwn(configuration, "pageViewsEnabled"));
    };

    await assert.rejects(
      db.$transaction(
        (tx) =>
          limits.withBoundedMediaRuntimeMutation(tx, project.id, () =>
            tx.projectMediaReplacement.create({ data: longMapping(113) }),
          ),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
      (error: unknown) =>
        error instanceof limits.MediaRuntimePayloadLimitError &&
        error.limit === limits.MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES,
      "A newly created mapping must be fully rolled back when all active languages exceed 224 KiB",
    );
    assert.equal(
      await db.projectMediaReplacement.count({
        where: { projectId: project.id, langTo: { in: ["en", "fr"] } },
      }),
      113,
    );
    await assertRuntimeStillAvailable();

    const initialReplacement =
      await db.projectMediaReplacement.findFirstOrThrow({
        where: { projectId: project.id, langTo: "en" },
        orderBy: { originalUrl: "asc" },
      });
    await assert.rejects(
      db.$transaction(
        (tx) =>
          limits.withBoundedMediaRuntimeMutation(tx, project.id, () =>
            tx.projectMediaReplacement.update({
              where: { id: initialReplacement.id, projectId: project.id },
              data: {
                originalUrl: `/uploads/${"x".repeat(2020)}.png`,
                localizedUrl: `/uploads/${"y".repeat(2020)}.webp`,
              },
            }),
          ),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
      limits.MediaRuntimePayloadLimitError,
      "An expanded mapping must be fully rolled back before existing plugin settings become unavailable",
    );
    const unchangedReplacement =
      await db.projectMediaReplacement.findUniqueOrThrow({
        where: { id: initialReplacement.id },
      });
    assert.equal(
      unchangedReplacement.originalUrl,
      initialReplacement.originalUrl,
    );
    assert.equal(
      unchangedReplacement.localizedUrl,
      initialReplacement.localizedUrl,
    );
    await assertRuntimeStillAvailable();

    const legacyOverflowRows = await Promise.all([
      db.projectMediaReplacement.create({ data: longMapping(113) }),
      db.projectMediaReplacement.create({ data: longMapping(114) }),
    ]);
    assert.equal((await runtime.GET(runtimeRequest(rawKey))).status, 413);

    await db.$transaction(
      (tx) =>
        limits.withBoundedMediaRuntimeMutation(tx, project.id, () =>
          tx.projectMediaReplacement.update({
            where: { id: initialReplacement.id, projectId: project.id },
            data: { localizedUrl: "/uploads/smaller.webp" },
          }),
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    assert.equal(
      (await runtime.GET(runtimeRequest(rawKey))).status,
      413,
      "A legacy oversized project may shrink progressively even before it is fully below the limit",
    );

    await db.projectMediaReplacement.deleteMany({
      where: {
        projectId: project.id,
        id: { in: legacyOverflowRows.map(({ id }) => id) },
      },
    });
    await assertRuntimeStillAvailable();
  },
);

test(
  "PostgreSQL retries concurrent serializable partial image updates without losing either field",
  { skip: skipWithoutDatabase, timeout: 30_000 },
  async () => {
    const [{ db }, limits] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/media-runtime-limits"),
    ]);
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: {
        name: `Concurrent media ${suffix}`,
        slug: `concurrent-media-${suffix}`,
      },
    });
    cleanupOrganizationIds.add(organization.id);
    const project = await db.project.create({
      data: {
        name: "Concurrent image mapping project",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        organizationId: organization.id,
        languages: { create: [{ langCode: "en", isActive: true }] },
      },
    });
    const replacement = await db.projectMediaReplacement.create({
      data: {
        projectId: project.id,
        langTo: "en",
        originalUrl: "/uploads/original.png",
        localizedUrl: "/uploads/original-en.webp",
      },
    });

    let transactionsAtBarrier = 0;
    let releaseBarrier!: () => void;
    const firstSnapshotsReady = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    let serializationConflicts = 0;

    const updateOnlySuppliedFields = async (
      changes: Prisma.ProjectMediaReplacementUpdateInput,
    ) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await db.$transaction(
            async (tx) => {
              await tx.projectMediaReplacement.findFirstOrThrow({
                where: { id: replacement.id, projectId: project.id },
              });

              if (attempt === 0) {
                transactionsAtBarrier += 1;
                if (transactionsAtBarrier === 2) {
                  releaseBarrier();
                }
                await firstSnapshotsReady;
              }

              return limits.withBoundedMediaRuntimeMutation(
                tx,
                project.id,
                () =>
                  tx.projectMediaReplacement.update({
                    where: { id: replacement.id, projectId: project.id },
                    data: changes,
                  }),
              );
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
              maxWait: 5_000,
              timeout: 10_000,
            },
          );
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2034" &&
            attempt < 2
          ) {
            serializationConflicts += 1;
            continue;
          }

          throw error;
        }
      }

      throw new Error("Concurrent image update exceeded its retry budget.");
    };

    await Promise.all([
      updateOnlySuppliedFields({
        originalUrl: "/uploads/concurrent-source.png",
      }),
      updateOnlySuppliedFields({
        localizedUrl: "/uploads/concurrent-localized.webp",
      }),
    ]);

    assert.ok(
      serializationConflicts >= 1,
      "Both transactions must first observe the same row and exercise a real PostgreSQL P2034 retry",
    );
    const mergedUpdate = await db.projectMediaReplacement.findUniqueOrThrow({
      where: { id: replacement.id },
    });
    assert.equal(mergedUpdate.originalUrl, "/uploads/concurrent-source.png");
    assert.equal(
      mergedUpdate.localizedUrl,
      "/uploads/concurrent-localized.webp",
    );
  },
);

test(
  "PostgreSQL rolls back language reactivation when preserved image mappings would disable plugin runtime",
  { skip: skipWithoutDatabase, timeout: 30_000 },
  async () => {
    const [{ db }, { generateApiKey }, runtime, limits, languageMutations] =
      await Promise.all([
        import("@/lib/db"),
        import("@/lib/api-keys"),
        import("@/app/api/plugin/runtime-config/route"),
        import("@/lib/media-runtime-limits"),
        import("@/lib/project-language-mutations"),
      ]);
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: {
        name: `Reactivated media ${suffix}`,
        slug: `reactivated-media-${suffix}`,
      },
    });
    cleanupOrganizationIds.add(organization.id);

    const project = await db.project.create({
      data: {
        name: "Reactivated image mapping project",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        organizationId: organization.id,
        languages: {
          create: [
            { langCode: "en", isActive: true },
            { langCode: "fr", isActive: true },
          ],
        },
      },
    });
    const { rawKey, apiKey } = await generateApiKey({
      projectId: project.id,
      name: "Integration-only language-reactivation key",
    });
    cleanupApiKeyIds.add(apiKey.id);

    await db.projectMediaReplacement.createMany({
      data: Array.from({ length: 114 }, (_, index) => ({
        projectId: project.id,
        langTo: index < 60 ? "en" : "fr",
        originalUrl: `/uploads/${index}-${"a".repeat(990)}.png`,
        localizedUrl: `/uploads/${index}-${"b".repeat(990)}.webp`,
      })),
    });
    await db.projectLanguage.delete({
      where: {
        projectId_langCode: { projectId: project.id, langCode: "fr" },
      },
    });
    assert.equal(
      await db.projectMediaReplacement.count({
        where: { projectId: project.id, langTo: "fr" },
      }),
      54,
      "Removing a project language must preserve its image mappings for possible later reuse",
    );

    const previousRuntime = await runtime.GET(runtimeRequest(rawKey));
    assert.equal(previousRuntime.status, 200);
    assert.deepEqual(
      Object.keys((await previousRuntime.json()).mediaReplacements),
      ["en"],
    );

    await assert.rejects(
      languageMutations.addProjectTargetLanguages(db, {
        projectId: project.id,
        languages: ["en", "fr"],
      }),
      limits.MediaRuntimePayloadLimitError,
      "The real dashboard language mutation must roll back when preserved mappings overflow the runtime JSON",
    );
    assert.equal(
      await db.projectLanguage.count({
        where: { projectId: project.id, langCode: "fr" },
      }),
      0,
      "An oversized language activation must not persist any partial language creation",
    );
    assert.equal(
      await db.projectMediaReplacement.count({
        where: { projectId: project.id, langTo: "fr" },
      }),
      54,
      "Rejecting reactivation must never delete customer-owned localized media mappings",
    );

    const unaffectedRuntime = await runtime.GET(runtimeRequest(rawKey));
    assert.equal(unaffectedRuntime.status, 200);
    const unaffectedConfiguration = await unaffectedRuntime.json();
    assert.ok(Object.hasOwn(unaffectedConfiguration, "exclusions"));
    assert.ok(Object.hasOwn(unaffectedConfiguration, "urlSlugs"));
    assert.ok(Object.hasOwn(unaffectedConfiguration, "pageViewsEnabled"));

    await db.projectMediaReplacement.updateMany({
      where: { projectId: project.id, langTo: "fr" },
      data: { localizedUrl: "/uploads/short.webp" },
    });
    const activated = await languageMutations.addProjectTargetLanguages(db, {
      projectId: project.id,
      languages: ["en", "fr"],
    });
    assert.deepEqual(activated, { kind: "updated" });
    assert.equal(
      await db.projectMediaReplacement.count({
        where: { projectId: project.id },
      }),
      114,
      "A safe reactivation restores all preserved image mappings without deleting or recreating them",
    );

    const restoredRuntime = await runtime.GET(runtimeRequest(rawKey));
    assert.equal(restoredRuntime.status, 200);
    assert.deepEqual(
      Object.keys((await restoredRuntime.json()).mediaReplacements),
      ["en", "fr"],
    );

    await db.projectLanguage.update({
      where: {
        projectId_langCode: { projectId: project.id, langCode: "fr" },
      },
      data: { isActive: false },
    });
    const inactiveRuntime = await runtime.GET(runtimeRequest(rawKey));
    assert.equal(inactiveRuntime.status, 200);
    assert.deepEqual(
      Object.keys((await inactiveRuntime.json()).mediaReplacements),
      ["en"],
    );

    const reactivatedExisting =
      await languageMutations.addProjectTargetLanguages(db, {
        projectId: project.id,
        languages: ["en", "fr"],
      });
    assert.deepEqual(
      reactivatedExisting,
      { kind: "updated" },
      "Existing project-language rows remain unique while inactive rows are explicitly reactivated",
    );
    assert.equal(
      (
        await db.projectLanguage.findUniqueOrThrow({
          where: {
            projectId_langCode: { projectId: project.id, langCode: "fr" },
          },
        })
      ).isActive,
      true,
    );
    assert.equal(
      await db.projectMediaReplacement.count({
        where: { projectId: project.id, langTo: "fr" },
      }),
      54,
    );
    const reactivatedRuntime = await runtime.GET(runtimeRequest(rawKey));
    assert.equal(reactivatedRuntime.status, 200);
    assert.deepEqual(
      Object.keys((await reactivatedRuntime.json()).mediaReplacements),
      ["en", "fr"],
    );
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
