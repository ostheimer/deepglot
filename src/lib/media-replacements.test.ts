import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RUNTIME_MEDIA_REPLACEMENTS,
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
