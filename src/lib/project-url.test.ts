import test from "node:test";
import assert from "node:assert/strict";

import { getProjectUrl, getVisualEditorUrl } from "@/lib/project-url";

test("builds https URLs for regular project domains", () => {
  assert.equal(getProjectUrl("example.com"), "https://example.com");
  assert.equal(getProjectUrl("sub.example.com"), "https://sub.example.com");
});

test("builds http URLs for localhost-style domains", () => {
  assert.equal(getProjectUrl("localhost:3000"), "http://localhost:3000");
  assert.equal(getProjectUrl("127.0.0.1:8787"), "http://127.0.0.1:8787");
});

test("preserves explicit protocols", () => {
  assert.equal(getProjectUrl("https://example.com"), "https://example.com");
  assert.equal(getProjectUrl("http://localhost:3000"), "http://localhost:3000");
});

test("appends the visual editor flag to project URLs", () => {
  assert.equal(
    getVisualEditorUrl("example.com"),
    "https://example.com/?deepglot_editor=1"
  );
  assert.equal(
    getVisualEditorUrl("https://example.com/path"),
    "https://example.com/path?deepglot_editor=1"
  );
});
