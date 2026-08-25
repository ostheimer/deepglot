import { expect, test } from "@playwright/test";

import { e2eId, signInAndGetProjectId } from "./helpers";

test("project managers safely manage locale-specific image mappings end to end", async ({
  page,
  request,
}) => {
  const projectId = await signInAndGetProjectId(page);
  const collectionPath = `/api/projects/${projectId}/media`;
  const projectResponse = await page.request.get(`/api/projects/${projectId}`);
  expect(projectResponse.status()).toBe(200);

  const originalProject = (await projectResponse.json()) as { domain: string };
  const projectDomain = `${e2eId("media")}.example.test`;
  const originalUrl = "/wp-content/uploads/deepglot-e2e-image.jpg?revision=1";
  const englishUrl = "/wp-content/uploads/deepglot-e2e-image-en.webp";
  const frenchUrl = "/wp-content/uploads/deepglot-e2e-image-fr.avif";
  let mappingId: string | undefined;
  let apiKeyId: string | undefined;

  try {
    const domainResponse = await page.request.patch(`/api/projects/${projectId}`, {
      data: { domain: projectDomain },
    });
    expect(domainResponse.status()).toBe(200);

    expect((await request.get(collectionPath)).status()).toBe(401);

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
    expect(listing.mediaReplacements.some((entry) => entry.id === mappingId)).toBe(true);

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

    expect((await runtimeConfig()).mediaReplacements.en?.[originalUrl]).toBe(englishUrl);

    const updateResponse = await page.request.patch(
      `${collectionPath}/${mappingId}`,
      { data: { langTo: "fr", localizedUrl: frenchUrl } },
    );
    expect(updateResponse.status()).toBe(200);

    const updatedRuntime = await runtimeConfig();
    expect(updatedRuntime.mediaReplacements.en?.[originalUrl]).toBeUndefined();
    expect(updatedRuntime.mediaReplacements.fr?.[originalUrl]).toBe(frenchUrl);

    const deleteResponse = await page.request.delete(
      `${collectionPath}/${mappingId}`,
    );
    expect(deleteResponse.status()).toBe(200);
    mappingId = undefined;
    expect((await runtimeConfig()).mediaReplacements.fr?.[originalUrl]).toBeUndefined();
  } finally {
    if (mappingId) {
      await page.request.delete(`${collectionPath}/${mappingId}`);
    }
    if (apiKeyId) {
      await page.request.delete(`/api/projects/${projectId}/api-keys/${apiKeyId}`);
    }

    const restoreResponse = await page.request.patch(`/api/projects/${projectId}`, {
      data: { domain: originalProject.domain },
    });
    expect(restoreResponse.status()).toBe(200);
  }
});
