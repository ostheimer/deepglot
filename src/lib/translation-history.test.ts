import assert from "node:assert/strict";
import { test } from "node:test";
import { boundHistoryPage, translationHistoryQuerySchema } from "./translation-history";
import { HISTORY_KEYS, historyText } from "./translation-history-copy";
import { SITE_LOCALES } from "./site-locale";

test("history pagination rejects unbounded, malformed and unexpected input", () => {
  assert.equal(translationHistoryQuerySchema.parse({}).pageSize, 10);
  for (const input of [{ pageSize: 0 }, { pageSize: 21 }, { pageSize: 1.5 }, { cursor: "" }, { cursor: "x".repeat(129) }, { projectId: "other" }]) {
    assert.equal(translationHistoryQuerySchema.safeParse(input).success, false);
  }
});
test("history pages stay within response limits for large Unicode text without skipping revisions", () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({ id: String(i), beforeText: "🦉".repeat(100_000), afterText: "🦉".repeat(100_000) }));
  const result = boundHistoryPage(rows, 20);
  assert.equal(result.items.length, 3);
  assert.equal(result.nextCursor, "2");
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 3_000_100);
  assert.equal(boundHistoryPage([], 10).nextCursor, null);
});
test("history copy covers all supported locales and explains its limited scope", () => {
  for (const locale of SITE_LOCALES) {
    for (const key of HISTORY_KEYS) {
      const value = historyText(locale, key);
      assert.ok(value?.trim(), `${locale}/${key}`);
      if (locale !== "en") assert.notEqual(value, historyText("en", key), `${locale}/${key}`);
    }
  }
  assert.match(historyText("de", "title"), /Änderung/);
  assert.match(historyText("en", "scope"), /Earlier edits and other editors are not included/);
});

test("an oversized imported first revision is bounded and pagination resumes after it", () => {
  const rows = [{ id: "large", beforeText: "🦉".repeat(1_000_000), afterText: "new" }, { id: "older", beforeText: "old", afterText: "older" }];
  const result = boundHistoryPage(rows, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 3_000_000);
  assert.equal(result.nextCursor, "large");
  assert.equal(result.items[0].id, "large");
  assert.equal(result.items[0].afterText, "new");
  assert.equal(result.items[0].textTruncated, true);
  assert.ok(result.items[0].beforeText.length < rows[0].beforeText.length);
  assert.equal(rows[0].beforeText.length, 2_000_000);
  assert.equal(boundHistoryPage(rows.slice(1), 1).items[0].id, "older");
  const escaped = boundHistoryPage([{ id: "escaped", beforeText: "\u0001".repeat(1_000_000), afterText: "\u0001".repeat(1_000_000) }], 1);
  assert.ok(Buffer.byteLength(JSON.stringify(escaped)) < 3_000_000);
  const unicode = boundHistoryPage([{ id: "unicode", beforeText: "x" + "🦉".repeat(1_000_000), afterText: "new" }], 1);
  assert.doesNotMatch(unicode.items[0].beforeText, /[\uD800-\uDBFF]$/);
});
