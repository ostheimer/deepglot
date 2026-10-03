import assert from "node:assert/strict";
import test from "node:test";

import { getWordPressSettingsUrl } from "./project-url";

test("WordPress settings link preserves a synced subdirectory installation", () => {
  assert.equal(
    getWordPressSettingsUrl("example.com", "example.com/blog"),
    "https://example.com/blog/wp-admin/options-general.php?page=deepglot",
  );
  assert.equal(
    getWordPressSettingsUrl("example.com", "other.example/blog"),
    "https://example.com/wp-admin/options-general.php?page=deepglot",
  );
  assert.equal(
    getWordPressSettingsUrl("https://example.com/blog/", null),
    "https://example.com/blog/wp-admin/options-general.php?page=deepglot",
  );
  assert.equal(
    getWordPressSettingsUrl("example.com", "www.example.com/blog"),
    "https://example.com/blog/wp-admin/options-general.php?page=deepglot",
  );
});
