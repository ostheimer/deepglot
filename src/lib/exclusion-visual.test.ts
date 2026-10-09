import assert from "node:assert/strict";
import test from "node:test";

import { projectPreviewUrl, VisualPreviewError } from "@/lib/exclusion-visual";
import { stableVisualToken } from "@/lib/exclusion-visual-selector";

test("visual preview path cannot change project origin or reach an internal host", () => {
  assert.equal(projectPreviewUrl("example.com", "/products?x=1").href, "https://example.com/products?x=1");
  for (const path of ["https://other.example/", "//other.example/", "/\\other.example/", "/\u0000admin"]) {
    assert.throws(() => projectPreviewUrl("example.com", path), VisualPreviewError);
  }
  assert.throws(() => projectPreviewUrl("127.0.0.1", "/"));
});

test("visual selector accepts semantic tokens and rejects volatile or generic rules", () => {
  for (const value of ["hero-title", "kontakt_bereich", "überblick", "product-42-description"]) {
    assert.equal(stableVisualToken(value), true, value);
  }
  for (const value of ["body", "row", "open", "wp-block-group", "menu", "x", "item-abcdef123456", "user_session_42", "a:b", "a b"]) {
    assert.equal(stableVisualToken(value), false, value);
  }
});
