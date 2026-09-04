import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_MEDIA_IMAGE_URL_LENGTH,
  MAX_RUNTIME_MEDIA_REPLACEMENTS,
  MediaReplacementError,
  assertMediaReplacementCapacity,
  buildRuntimeMediaReplacements,
  normalizeMediaImageUrl,
} from "@/lib/media-replacements";

test("same-project HTTPS and root-relative image URLs share one canonical path", () => {
  assert.equal(
    normalizeMediaImageUrl(
      "https://EXAMPLE.com/wp-content/uploads/Hero.PNG?version=7",
      "example.com"
    ),
    "/wp-content/uploads/Hero.PNG?version=7"
  );
  assert.equal(
    normalizeMediaImageUrl("/wp-content/uploads/hero-en.webp", "example.com"),
    "/wp-content/uploads/hero-en.webp"
  );

  for (const extension of ["png", "jpg", "jpeg", "webp", "avif", "gif"]) {
    assert.equal(
      normalizeMediaImageUrl(`/uploads/image.${extension}`, "example.com"),
      `/uploads/image.${extension}`
    );
  }
});

test("project domains with explicit ports accept only their exact media origin", () => {
  assert.equal(
    normalizeMediaImageUrl("/uploads/image.png", "example.com:8080"),
    "/uploads/image.png"
  );
  assert.equal(
    normalizeMediaImageUrl(
      "https://example.com:8080/uploads/image.png",
      "example.com:8080"
    ),
    "/uploads/image.png"
  );
  assert.throws(
    () =>
      normalizeMediaImageUrl(
        "https://example.com:8443/uploads/image.png",
        "example.com:8080"
      ),
    (error: unknown) =>
      error instanceof MediaReplacementError &&
      error.code === "INVALID_IMAGE_URL"
  );
});

test("canonical image paths enforce the URL limit after Unicode percent encoding", () => {
  const pathPrefix = "/uploads/";
  const extension = ".png";
  const unicodeCharacters = Math.floor(
    (MAX_MEDIA_IMAGE_URL_LENGTH - pathPrefix.length - extension.length) / 6
  );
  const remainingAsciiCharacters =
    MAX_MEDIA_IMAGE_URL_LENGTH -
    pathPrefix.length -
    extension.length -
    unicodeCharacters * 6;
  const exactlyAtLimit =
    pathPrefix +
    "é".repeat(unicodeCharacters) +
    "a".repeat(remainingAsciiCharacters) +
    extension;

  assert.ok(exactlyAtLimit.length < MAX_MEDIA_IMAGE_URL_LENGTH);
  assert.equal(
    normalizeMediaImageUrl(exactlyAtLimit, "example.com").length,
    MAX_MEDIA_IMAGE_URL_LENGTH
  );

  const aboveLimit =
    pathPrefix +
    "é".repeat(unicodeCharacters) +
    "a".repeat(remainingAsciiCharacters + 1) +
    extension;

  for (const imageUrl of [aboveLimit, `https://example.com${aboveLimit}`]) {
    assert.ok(imageUrl.length < MAX_MEDIA_IMAGE_URL_LENGTH);
    assert.throws(
      () => normalizeMediaImageUrl(imageUrl, "example.com"),
      (error: unknown) =>
        error instanceof MediaReplacementError &&
        error.code === "INVALID_IMAGE_URL",
      "Canonical paths beyond 2,048 characters must be rejected before persistence"
    );
  }
});

test("canonical image queries enforce the URL limit after Unicode percent encoding", () => {
  const queryPrefix = "/uploads/image.webp?caption=";
  const unicodeCharacters = Math.floor(
    (MAX_MEDIA_IMAGE_URL_LENGTH - queryPrefix.length) / 6
  );
  const remainingAsciiCharacters =
    MAX_MEDIA_IMAGE_URL_LENGTH - queryPrefix.length - unicodeCharacters * 6;
  const exactlyAtLimit =
    queryPrefix +
    "é".repeat(unicodeCharacters) +
    "a".repeat(remainingAsciiCharacters);

  assert.equal(
    normalizeMediaImageUrl(exactlyAtLimit, "example.com").length,
    MAX_MEDIA_IMAGE_URL_LENGTH
  );

  const aboveLimit = exactlyAtLimit + "a";
  assert.ok(aboveLimit.length < MAX_MEDIA_IMAGE_URL_LENGTH);
  assert.throws(
    () => normalizeMediaImageUrl(aboveLimit, "example.com"),
    (error: unknown) =>
      error instanceof MediaReplacementError &&
      error.code === "INVALID_IMAGE_URL",
    "Canonical query strings beyond 2,048 characters must be rejected before persistence"
  );
});

test("media images reject foreign origins, userinfo, insecure schemes and IP hosts", () => {
  const rejectedUrls = [
    "https://cdn.example.com/uploads/image.png",
    "https://attacker.example/uploads/image.png",
    "http://example.com/uploads/image.png",
    "//attacker.example/uploads/image.png",
    "https://user@example.com/uploads/image.png",
    "https://user:password@example.com/uploads/image.png",
    "https://example.com@attacker.example/uploads/image.png",
    "javascript:alert(1).png",
    "data:image/png;base64,AAAA",
    "file:///uploads/image.png",
    "https://127.0.0.1/uploads/image.png",
    "https://192.168.0.1/uploads/image.png",
    "https://[::1]/uploads/image.png",
    "https://localhost/uploads/image.png",
  ];

  for (const value of rejectedUrls) {
    assert.throws(
      () => normalizeMediaImageUrl(value, "example.com"),
      `expected unsafe image URL to fail: ${value}`
    );
  }

  for (const projectDomain of [
    "127.0.0.1",
    "192.168.0.1",
    "8.8.8.8",
    "[::1]",
    "localhost",
    "service.internal",
  ]) {
    assert.throws(
      () => normalizeMediaImageUrl("/uploads/image.png", projectDomain),
      `expected unsafe project domain to fail: ${projectDomain}`
    );
  }
});

test("media images reject executable formats, traversal, fragments and ambiguous paths", () => {
  const rejectedUrls = [
    "/uploads/image.svg",
    "/uploads/image.pdf",
    "/uploads/image.php",
    "/uploads/image.png/execute.php",
    "/uploads/image.png#fragment",
    "/uploads/../image.png",
    "/uploads/%2e%2e/image.png",
    "/uploads/%2f%2fattacker.example/image.png",
    "/uploads/%5cattacker.example/image.png",
    "/uploads/\\attacker.example/image.png",
    "/uploads/image\u0000.png",
    "uploads/image.png",
    "/uploads/" + "a".repeat(2048) + ".png",
  ];

  for (const value of rejectedUrls) {
    assert.throws(
      () => normalizeMediaImageUrl(value, "example.com"),
      `expected unsafe image path to fail: ${JSON.stringify(value)}`
    );
  }
});

test("media images reject the recursively encoded path delimiters WordPress rejects after one decode", () => {
  const rejectedPaths = [
    "/uploads/%252e%252e/image.png",
    "/uploads/%252E%252E/image.png",
    "/uploads/private%252fasset.png",
    "/uploads/private%252Fasset.png",
    "/uploads/private%255casset.png",
    "/uploads/private%255Casset.png",
    "/uploads/private%25%32%66asset.png",
    "/uploads/private%25%35%63asset.png",
  ];

  for (const path of rejectedPaths) {
    for (const imageUrl of [path, `https://example.com${path}`]) {
      assert.throws(
        () => normalizeMediaImageUrl(imageUrl, "example.com"),
        (error: unknown) =>
          error instanceof MediaReplacementError &&
          error.code === "INVALID_IMAGE_URL",
        `WordPress-incompatible recursively encoded image paths must fail before persistence: ${imageUrl}`
      );
    }

    assert.throws(() =>
      buildRuntimeMediaReplacements([
        {
          langTo: "en",
          originalUrl: "/uploads/original.png",
          localizedUrl: path,
        },
      ])
    );
  }
});

test("media images retain WordPress-compatible literal percent encodings and query strings", () => {
  const acceptedPaths = [
    "/uploads/discount%25.png",
    "/uploads/hash%2523asset.png",
    "/uploads/nul%2500asset.png",
    "/uploads/triple%25252fasset.png",
    "/uploads/%25252e%25252e/image.png",
    "/uploads/image.png?literal=%252f&hash=%2523&discount=50%25",
  ];

  for (const path of acceptedPaths) {
    assert.equal(
      normalizeMediaImageUrl(path, "example.com"),
      path,
      `WordPress accepts this literal percent sequence after exactly one decode: ${path}`
    );
  }
});

test("canonical image URLs normalize percent-escape casing before persistence", () => {
  assert.equal(
    normalizeMediaImageUrl(
      "/uploads/caf%c3%a9.png?currency=%e2%82%ac",
      "example.com"
    ),
    "/uploads/caf%C3%A9.png?currency=%E2%82%AC"
  );
  assert.equal(
    normalizeMediaImageUrl(
      "https://example.com/uploads/caf%C3%a9.png?currency=%E2%82%ac",
      "example.com"
    ),
    "/uploads/caf%C3%A9.png?currency=%E2%82%AC"
  );
});

test("runtime media mappings are grouped by active target-language shape", () => {
  assert.deepEqual(
    buildRuntimeMediaReplacements([
      {
        langTo: "en",
        originalUrl: "/uploads/original.png",
        localizedUrl: "/uploads/english.webp",
      },
      {
        langTo: "de",
        originalUrl: "/uploads/original.png",
        localizedUrl: "/uploads/deutsch.avif",
      },
      {
        langTo: "en",
        originalUrl: "/uploads/second.jpg?version=2",
        localizedUrl: "/uploads/second-en.jpeg?version=3",
      },
    ]),
    {
      en: {
        "/uploads/original.png": "/uploads/english.webp",
        "/uploads/second.jpg?version=2": "/uploads/second-en.jpeg?version=3",
      },
      de: {
        "/uploads/original.png": "/uploads/deutsch.avif",
      },
    }
  );
});

test("runtime media mappings fail closed on unsafe rows, duplicate keys and overflow", () => {
  const validRow = {
    langTo: "en",
    originalUrl: "/uploads/original.png",
    localizedUrl: "/uploads/english.webp",
  };

  for (const invalidRow of [
    { ...validRow, langTo: "__proto__" },
    { ...validRow, originalUrl: "https://attacker.example/image.png" },
    { ...validRow, localizedUrl: "/uploads/executable.svg" },
  ]) {
    assert.throws(() => buildRuntimeMediaReplacements([invalidRow]));
  }

  assert.throws(() =>
    buildRuntimeMediaReplacements([
      validRow,
      { ...validRow, localizedUrl: "/uploads/other.webp" },
    ])
  );

  assert.equal(MAX_RUNTIME_MEDIA_REPLACEMENTS, 500);
  assert.throws(() =>
    buildRuntimeMediaReplacements(
      Array.from({ length: MAX_RUNTIME_MEDIA_REPLACEMENTS + 1 }, (_, index) => ({
        ...validRow,
        originalUrl: `/uploads/image-${index}.png`,
      }))
    )
  );
});

test("project image admission stops before runtime mappings can exceed 500", () => {
  assert.doesNotThrow(() => assertMediaReplacementCapacity(0));
  assert.doesNotThrow(() =>
    assertMediaReplacementCapacity(MAX_RUNTIME_MEDIA_REPLACEMENTS - 1)
  );
  assert.throws(() =>
    assertMediaReplacementCapacity(MAX_RUNTIME_MEDIA_REPLACEMENTS)
  );
  assert.throws(() =>
    assertMediaReplacementCapacity(MAX_RUNTIME_MEDIA_REPLACEMENTS + 1)
  );
});
