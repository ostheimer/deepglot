import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeExclusions,
  isUrlExcluded,
  normalizeExclusionInput,
} from "@/lib/exclusions";

test("normalizes dashboard exclusion input", () => {
  assert.deepEqual(normalizeExclusionInput({ type: "CSS_CLASS", value: ".no-translate" }), {
    type: "CSS_CLASS",
    value: "no-translate",
  });
  assert.deepEqual(normalizeExclusionInput({ type: "CSS_ID", value: "#hero" }), {
    type: "CSS_ID",
    value: "hero",
  });
  assert.deepEqual(normalizeExclusionInput({ type: "URL", value: " /kontakt " }), {
    type: "URL",
    value: "/kontakt",
  });
  assert.deepEqual(normalizeExclusionInput({ type: "REGEX", value: " /checkout/ " }), {
    type: "REGEX",
    value: "/checkout/",
  });
});

test("serializes runtime exclusions for the plugin contract", () => {
  assert.deepEqual(
    buildRuntimeExclusions([
      { type: "URL", value: "/kontakt" },
      { type: "REGEX", value: "^/cart" },
      { type: "CSS_CLASS", value: "no-translate" },
      { type: "CSS_ID", value: "hero" },
    ]),
    {
      urls: ["/kontakt"],
      regexes: ["^/cart"],
      selectors: [".no-translate", "#hero"],
    }
  );
});

test("matches URL exclusions and ignores invalid regexes safely", () => {
  assert.equal(
    isUrlExcluded("https://example.com/en/kontakt", {
      urls: ["/kontakt"],
      regexes: [],
      selectors: [],
    }),
    true
  );
  assert.equal(
    isUrlExcluded("https://example.com/en/products/sale", {
      urls: ["/products/*"],
      regexes: [],
      selectors: [],
    }),
    true
  );
  assert.equal(
    isUrlExcluded("https://example.com/en/shop", {
      urls: [],
      regexes: ["["],
      selectors: [],
    }),
    false
  );
});
