import assert from "node:assert/strict";
import test from "node:test";
import {
  filterMediaMappings,
  mediaDisplayKind,
  mediaMappingPayload,
} from "./media-dashboard";
import { toInternalPath, withLocalePrefix } from "./site-locale";

const rows = [
  {
    id: "image-en",
    langTo: "en",
    originalUrl: "/uploads/PHOTO.JPG?revision=2",
    localizedUrl: "/uploads/photo-en.webp",
  },
  {
    id: "pdf-fr",
    langTo: "fr",
    originalUrl: "/uploads/guide.pdf",
    localizedUrl: "/uploads/guide-fr.pdf",
  },
  {
    id: "video-en",
    langTo: "en",
    originalUrl: "/uploads/demo.webm",
    localizedUrl: "/uploads/demo-en.webm",
  },
  {
    id: "embed-en",
    langTo: "en",
    originalUrl: "https://www.youtube-nocookie.com/embed/abcdefghijk",
    localizedUrl: "https://www.youtube-nocookie.com/embed/lmnopqrstuv",
  },
];

test("media edits send only dirty fields and skip unchanged or reverted values", () => {
  const baseline = rows[0];
  assert.deepEqual(
    mediaMappingPayload({ ...baseline, langTo: "fr" }, baseline),
    { langTo: "fr" },
  );
  assert.deepEqual(mediaMappingPayload({ ...baseline }, baseline), {});
  assert.deepEqual(
    mediaMappingPayload(
      { ...baseline, localizedUrl: "/uploads/new.webp" },
      baseline,
    ),
    { localizedUrl: "/uploads/new.webp" },
  );
  assert.deepEqual(mediaMappingPayload(baseline, null), {
    langTo: baseline.langTo,
    originalUrl: baseline.originalUrl,
    localizedUrl: baseline.localizedUrl,
  });
});

test("media search combines target language, validated media type and both URLs", () => {
  assert.deepEqual(filterMediaMappings(rows, "  PHOTO-EN  ", "en", "image"), [
    rows[0],
  ]);
  assert.deepEqual(filterMediaMappings(rows, "guide", "en", ""), []);
  assert.deepEqual(filterMediaMappings(rows, "", "en", "video"), [rows[2]]);
  assert.deepEqual(filterMediaMappings(rows, "lmnopqrstuv", "en", "embed"), [
    rows[3],
  ]);
  assert.equal(filterMediaMappings(rows, "", "", "").length, 4);
  assert.equal(mediaDisplayKind("/uploads/slides.pptx?download=1"), "document");
  assert.equal(mediaDisplayKind("https://player.vimeo.com/video/123"), "embed");
});

test("media routes use the existing localized aliases and German internal directory", () => {
  assert.equal(
    withLocalePrefix("/projects/project-1/translations/media", "en"),
    "/projects/project-1/translations/media",
  );
  assert.equal(
    withLocalePrefix("/projects/project-1/translations/media", "de"),
    "/de/projekte/project-1/uebersetzungen/medien",
  );
  assert.equal(
    toInternalPath("/projects/project-1/translations/media"),
    "/projekte/project-1/uebersetzungen/medien",
  );
});
