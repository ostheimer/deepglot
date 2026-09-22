import { expect, test } from "@playwright/test";

import { db } from "../../src/lib/db";
import { e2eId, signInAndGetProjectId } from "./helpers";

test("project managers safely manage locale-specific image mappings end to end", async ({
  page,
  request,
}) => {
  const projectId = await signInAndGetProjectId(page);
  const collectionPath = `/api/projects/${projectId}/media`;
  const projectResponse = await page.request.get(`/api/projects/${projectId}`);
  expect(projectResponse.status()).toBe(200);

  const originalProject = (await projectResponse.json()) as {
    domain: string;
    version: string;
  };
  const projectDomain = `${e2eId("media")}.example.test`;
  const originalUrl = "/wp-content/uploads/deepglot-e2e-image.jpg?revision=1";
  const englishUrl = "/wp-content/uploads/deepglot-e2e-image-en.webp";
  const frenchUrl = "/wp-content/uploads/deepglot-e2e-image-fr.avif";
  let mappingId: string | undefined;
  let apiKeyId: string | undefined;

  try {
    const domainResponse = await page.request.patch(
      `/api/projects/${projectId}`,
      {
        data: {
          expectedVersion: originalProject.version,
          domain: projectDomain,
        },
      },
    );
    expect(domainResponse.status()).toBe(200);

    expect((await request.get(collectionPath)).status()).toBe(401);

    const expandedOriginalUnicodeResponse = await page.request.post(
      collectionPath,
      {
        data: {
          langTo: "en",
          originalUrl: `/wp-content/uploads/${"é".repeat(350)}.jpg`,
          localizedUrl: englishUrl,
        },
      },
    );
    if (expandedOriginalUnicodeResponse.status() === 201) {
      const unexpectedlyCreated =
        (await expandedOriginalUnicodeResponse.json()) as {
          mediaReplacement: { id: string };
        };
      await page.request.delete(
        `${collectionPath}/${unexpectedlyCreated.mediaReplacement.id}`,
      );
    }
    expect(expandedOriginalUnicodeResponse.status()).toBe(400);
    expect(await expandedOriginalUnicodeResponse.json()).toMatchObject({
      code: "invalid_media_image_url",
    });

    for (const recursivelyEncodedPath of [
      "/wp-content/uploads/%252e%252e/undeliverable.jpg",
      "/wp-content/uploads/private%252fasset.jpg",
    ]) {
      const response = await page.request.post(collectionPath, {
        data: {
          langTo: "en",
          originalUrl: recursivelyEncodedPath,
          localizedUrl: englishUrl,
        },
      });

      if (response.status() === 201) {
        const unexpectedlyCreated = (await response.json()) as {
          mediaReplacement: { id: string };
        };
        await page.request.delete(
          `${collectionPath}/${unexpectedlyCreated.mediaReplacement.id}`,
        );
      }

      expect(response.status()).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "invalid_media_image_url",
      });
    }

    const createResponse = await page.request.post(collectionPath, {
      data: {
        langTo: "en",
        originalUrl: `https://${projectDomain}${originalUrl}`,
        localizedUrl: englishUrl,
      },
    });
    expect(createResponse.status()).toBe(201);

    const created = (await createResponse.json()) as {
      mediaReplacement: {
        id: string;
        originalUrl: string;
        localizedUrl: string;
        langTo: string;
      };
    };
    mappingId = created.mediaReplacement.id;
    expect(created.mediaReplacement).toMatchObject({
      originalUrl,
      localizedUrl: englishUrl,
      langTo: "en",
    });

    const duplicateResponse = await page.request.post(collectionPath, {
      data: { langTo: "en", originalUrl, localizedUrl: frenchUrl },
    });
    expect(duplicateResponse.status()).toBe(409);
    expect(await duplicateResponse.json()).toMatchObject({
      code: "media_replacement_already_exists",
    });

    const foreignOriginResponse = await page.request.post(collectionPath, {
      data: {
        langTo: "fr",
        originalUrl,
        localizedUrl: "https://untrusted.example/deepglot-e2e-image.jpg",
      },
    });
    expect(foreignOriginResponse.status()).toBe(400);
    expect(await foreignOriginResponse.json()).toMatchObject({
      code: "invalid_media_image_url",
    });

    const recursivelyEncodedLocalizedResponse = await page.request.post(
      collectionPath,
      {
        data: {
          langTo: "fr",
          originalUrl,
          localizedUrl: "/wp-content/uploads/private%252fasset.webp",
        },
      },
    );
    expect(recursivelyEncodedLocalizedResponse.status()).toBe(400);
    expect(await recursivelyEncodedLocalizedResponse.json()).toMatchObject({
      code: "invalid_media_image_url",
    });

    const expandedLocalizedUnicodeResponse = await page.request.post(
      collectionPath,
      {
        data: {
          langTo: "fr",
          originalUrl,
          localizedUrl: `/wp-content/uploads/${"é".repeat(400)}.webp`,
        },
      },
    );
    expect(expandedLocalizedUnicodeResponse.status()).toBe(400);
    expect(await expandedLocalizedUnicodeResponse.json()).toMatchObject({
      code: "invalid_media_image_url",
    });

    const inactiveLanguageResponse = await page.request.post(collectionPath, {
      data: { langTo: "es", originalUrl, localizedUrl: frenchUrl },
    });
    expect(inactiveLanguageResponse.status()).toBe(400);
    expect(await inactiveLanguageResponse.json()).toMatchObject({
      code: "inactive_target_language",
    });

    const listingResponse = await page.request.get(collectionPath);
    expect(listingResponse.status()).toBe(200);
    const listing = (await listingResponse.json()) as {
      mediaReplacements: Array<{ id: string }>;
      limitExceeded: boolean;
    };
    expect(listing.limitExceeded).toBe(false);
    expect(
      listing.mediaReplacements.some((entry) => entry.id === mappingId),
    ).toBe(true);

    const keyResponse = await page.request.post(
      `/api/projects/${projectId}/api-keys`,
      { data: { name: e2eId("Media mapping acceptance") } },
    );
    expect(keyResponse.status()).toBe(200);
    const { rawKey, apiKey } = (await keyResponse.json()) as {
      rawKey: string;
      apiKey: { id: string };
    };
    apiKeyId = apiKey.id;

    const runtimeConfig = async () => {
      const response = await request.get("/api/plugin/runtime-config", {
        headers: { authorization: `Bearer ${rawKey}` },
      });
      expect(response.status()).toBe(200);

      return (await response.json()) as {
        mediaReplacements: Record<string, Record<string, string>>;
      };
    };

    expect((await runtimeConfig()).mediaReplacements.en?.[originalUrl]).toBe(
      englishUrl,
    );

    const [languageUpdate, imageUpdate] = await Promise.all([
      page.request.patch(`${collectionPath}/${mappingId}`, {
        data: { langTo: "fr" },
      }),
      page.request.patch(`${collectionPath}/${mappingId}`, {
        data: { localizedUrl: frenchUrl },
      }),
    ]);
    expect(languageUpdate.status()).toBe(200);
    expect(imageUpdate.status()).toBe(200);

    const updatedRuntime = await runtimeConfig();
    expect(updatedRuntime.mediaReplacements.en?.[originalUrl]).toBeUndefined();
    expect(updatedRuntime.mediaReplacements.fr?.[originalUrl]).toBe(frenchUrl);

    const deleteResponse = await page.request.delete(
      `${collectionPath}/${mappingId}`,
    );
    expect(deleteResponse.status()).toBe(200);
    mappingId = undefined;
    expect(
      (await runtimeConfig()).mediaReplacements.fr?.[originalUrl],
    ).toBeUndefined();
  } finally {
    if (mappingId) {
      await page.request.delete(`${collectionPath}/${mappingId}`);
    }
    if (apiKeyId) {
      await page.request.delete(
        `/api/projects/${projectId}/api-keys/${apiKeyId}`,
      );
    }

    const currentProjectResponse = await page.request.get(
      `/api/projects/${projectId}`,
    );
    expect(currentProjectResponse.status()).toBe(200);
    const currentProject = (await currentProjectResponse.json()) as {
      version: string;
    };
    const restoreResponse = await page.request.patch(
      `/api/projects/${projectId}`,
      {
        data: {
          expectedVersion: currentProject.version,
          domain: originalProject.domain,
        },
      },
    );
    expect(restoreResponse.status()).toBe(200);
  }
});

test("image management rejects oversized configurations without interrupting plugin refresh", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  const projectId = await signInAndGetProjectId(page);
  const collectionPath = `/api/projects/${projectId}/media`;
  const projectResponse = await page.request.get(`/api/projects/${projectId}`);
  expect(projectResponse.status()).toBe(200);

  const originalProject = (await projectResponse.json()) as {
    domain: string;
    version: string;
  };
  const prefix = e2eId("media-payload");
  const domain = `${prefix}.example.test`;
  const payloadLimit = 224 * 1024;
  const seededUrls: string[] = [];
  const inactiveLanguageCode = "it";
  let apiKeyId: string | undefined;
  let inactiveLanguageWasSeeded = false;

  try {
    const domainResponse = await page.request.patch(
      `/api/projects/${projectId}`,
      {
        data: {
          expectedVersion: originalProject.version,
          domain,
        },
      },
    );
    expect(domainResponse.status()).toBe(200);

    const existing = await db.projectMediaReplacement.findMany({
      where: { projectId, langTo: { in: ["en", "fr"] } },
      select: { langTo: true, originalUrl: true, localizedUrl: true },
    });
    const payload = Object.create(null) as Record<
      string,
      Record<string, string>
    >;
    for (const row of existing) {
      (payload[row.langTo] ??= Object.create(null))[row.originalUrl] =
        row.localizedUrl;
    }
    const english = (payload.en ??= Object.create(null));
    const payloadBytes = () =>
      new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    const rows: Array<{
      projectId: string;
      langTo: string;
      originalUrl: string;
      localizedUrl: string;
    }> = [];

    let overflow: { originalUrl: string; localizedUrl: string } | undefined;
    for (let index = 0; index < 500; index += 1) {
      const suffix = `${prefix}-${String(index).padStart(3, "0")}`;
      const originalUrl = `/wp-content/uploads/${suffix}-${"o".repeat(1_600)}.jpg`;
      const localizedUrl = `/wp-content/uploads/${suffix}-${"l".repeat(1_600)}.webp`;

      english[originalUrl] = localizedUrl;
      if (payloadBytes() > payloadLimit) {
        delete english[originalUrl];
        overflow = { originalUrl, localizedUrl };
        break;
      }

      rows.push({ projectId, langTo: "en", originalUrl, localizedUrl });
    }

    expect(overflow).toBeDefined();

    const paddingOriginalBase = `/wp-content/uploads/${prefix}-padding.jpg?fill=`;
    const paddingLocalizedBase = `/wp-content/uploads/${prefix}-padding.webp?fill=`;
    english[paddingOriginalBase] = paddingLocalizedBase;
    const paddingBaseBytes = payloadBytes();
    delete english[paddingOriginalBase];

    if (paddingBaseBytes + 32 <= payloadLimit) {
      let availablePadding = payloadLimit - paddingBaseBytes - 32;
      const originalPadding = Math.min(
        availablePadding,
        2_048 - paddingOriginalBase.length,
      );
      availablePadding -= originalPadding;
      const localizedPadding = Math.min(
        availablePadding,
        2_048 - paddingLocalizedBase.length,
      );
      const originalUrl = paddingOriginalBase + "p".repeat(originalPadding);
      const localizedUrl = paddingLocalizedBase + "q".repeat(localizedPadding);
      english[originalUrl] = localizedUrl;
      rows.push({ projectId, langTo: "en", originalUrl, localizedUrl });
    }

    expect(rows.length).toBeGreaterThan(0);
    expect(payloadBytes()).toBeLessThanOrEqual(payloadLimit);
    expect(payloadLimit - payloadBytes()).toBeLessThan(250);

    await db.projectMediaReplacement.createMany({ data: rows });
    seededUrls.push(...rows.map((row) => row.originalUrl));

    const keyResponse = await page.request.post(
      `/api/projects/${projectId}/api-keys`,
      { data: { name: e2eId("Media payload guard") } },
    );
    expect(keyResponse.status()).toBe(200);
    const { rawKey, apiKey } = (await keyResponse.json()) as {
      rawKey: string;
      apiKey: { id: string };
    };
    apiKeyId = apiKey.id;

    const readRuntime = () =>
      request.get("/api/plugin/runtime-config", {
        headers: { authorization: `Bearer ${rawKey}` },
      });

    expect((await readRuntime()).status()).toBe(200);

    const rejectedCreate = await page.request.post(collectionPath, {
      data: { langTo: "en", ...overflow! },
    });
    if (rejectedCreate.status() === 201) {
      const unexpectedlyCreated = (await rejectedCreate.json()) as {
        mediaReplacement: { id: string };
      };
      await page.request.delete(
        `${collectionPath}/${unexpectedlyCreated.mediaReplacement.id}`,
      );
    }
    expect(rejectedCreate.status()).toBe(409);
    expect(await rejectedCreate.json()).toMatchObject({
      code: "media_replacements_payload_too_large",
    });
    expect((await readRuntime()).status()).toBe(200);

    const firstRow = rows[0];
    const persistedRow = await db.projectMediaReplacement.findUniqueOrThrow({
      where: {
        projectId_langTo_originalUrl: {
          projectId,
          langTo: "en",
          originalUrl: firstRow.originalUrl,
        },
      },
      select: { id: true },
    });
    const oversizeLocalizedUrl =
      firstRow.localizedUrl +
      `?oversize=${"x".repeat(payloadLimit - payloadBytes() + 5)}`;
    expect(oversizeLocalizedUrl.length).toBeLessThanOrEqual(2_048);

    const rejectedUpdate = await page.request.patch(
      `${collectionPath}/${persistedRow.id}`,
      { data: { localizedUrl: oversizeLocalizedUrl } },
    );
    expect(rejectedUpdate.status()).toBe(409);
    expect(await rejectedUpdate.json()).toMatchObject({
      code: "media_replacements_payload_too_large",
    });
    expect((await readRuntime()).status()).toBe(200);

    expect(
      await db.projectLanguage.findFirst({
        where: { projectId, langCode: inactiveLanguageCode },
      }),
    ).toBeNull();

    const inactiveOriginalUrl = `/wp-content/uploads/${prefix}-inactive-${"i".repeat(300)}.jpg`;
    await db.projectMediaReplacement.create({
      data: {
        projectId,
        langTo: inactiveLanguageCode,
        originalUrl: inactiveOriginalUrl,
        localizedUrl: `/wp-content/uploads/${prefix}-localized-${"i".repeat(300)}.webp`,
      },
    });
    seededUrls.push(inactiveOriginalUrl);
    inactiveLanguageWasSeeded = true;

    const rejectedActivation = await page.request.post(
      `/api/projects/${projectId}/languages`,
      { data: { languages: [inactiveLanguageCode] } },
    );
    expect(rejectedActivation.status()).toBe(409);
    expect(await rejectedActivation.json()).toMatchObject({
      code: "media_replacements_payload_too_large",
    });
    expect(
      await db.projectLanguage.findFirst({
        where: { projectId, langCode: inactiveLanguageCode },
      }),
    ).toBeNull();
    expect((await readRuntime()).status()).toBe(200);

    const settingsSync = await request.post("/api/plugin/settings-sync", {
      headers: { authorization: `Bearer ${rawKey}` },
      data: {
        routingMode: "PATH_PREFIX",
        siteUrl: `https://${domain}`,
        sourceLanguage: "de",
        targetLanguages: ["en", "fr", inactiveLanguageCode],
        autoRedirect: false,
        translateEmails: false,
        translateSearch: false,
        translateAmp: false,
        domainMappings: [],
      },
    });
    expect(settingsSync.status()).toBe(200);
    expect(
      await db.projectLanguage.findFirst({
        where: { projectId, langCode: inactiveLanguageCode },
      }),
    ).toBeNull();
    expect((await readRuntime()).status()).toBe(200);
  } finally {
    if (inactiveLanguageWasSeeded) {
      await db.projectLanguage.deleteMany({
        where: { projectId, langCode: inactiveLanguageCode },
      });
    }
    if (seededUrls.length > 0) {
      await db.projectMediaReplacement.deleteMany({
        where: { projectId, originalUrl: { in: seededUrls } },
      });
    }
    if (apiKeyId) {
      await page.request.delete(
        `/api/projects/${projectId}/api-keys/${apiKeyId}`,
      );
    }

    const currentProjectResponse = await page.request.get(
      `/api/projects/${projectId}`,
    );
    expect(currentProjectResponse.status()).toBe(200);
    const currentProject = (await currentProjectResponse.json()) as {
      version: string;
    };
    const restoreResponse = await page.request.patch(
      `/api/projects/${projectId}`,
      {
        data: {
          expectedVersion: currentProject.version,
          domain: originalProject.domain,
        },
      },
    );
    expect(restoreResponse.status()).toBe(200);
  }
});
