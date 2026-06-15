import test from "node:test";
import assert from "node:assert/strict";

import { shouldRejectTranslateRequest } from "@/lib/translate-quota";

test("allows cache-only visitor traffic below the monthly limit", () => {
  assert.equal(
    shouldRejectTranslateRequest({
      wordsUsed: 9_500,
      wordsLimit: 10_000,
      pendingWordCount: 0,
      quotaProbe: false,
    }),
    false,
  );
});

test("allows cache-only visitor traffic even when quota is exhausted", () => {
  assert.equal(
    shouldRejectTranslateRequest({
      wordsUsed: 10_000,
      wordsLimit: 10_000,
      pendingWordCount: 0,
      quotaProbe: false,
    }),
    false,
  );
});

test("blocks fresh translations that would exceed the monthly limit", () => {
  assert.equal(
    shouldRejectTranslateRequest({
      wordsUsed: 9_999,
      wordsLimit: 10_000,
      pendingWordCount: 2,
      quotaProbe: false,
    }),
    true,
  );
});

test("quota_probe rejects cache-only health checks when quota is exhausted", () => {
  assert.equal(
    shouldRejectTranslateRequest({
      wordsUsed: 10_000,
      wordsLimit: 10_000,
      pendingWordCount: 0,
      quotaProbe: true,
    }),
    true,
  );
});

test("quota_probe still passes when quota headroom remains", () => {
  assert.equal(
    shouldRejectTranslateRequest({
      wordsUsed: 9_999,
      wordsLimit: 10_000,
      pendingWordCount: 0,
      quotaProbe: true,
    }),
    false,
  );
});
