import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectTranslationVariables,
  translationMetadataSchema,
} from "./translation-metadata";

test("metadata normalizes labels without changing notes or variable spelling", () => {
  assert.deepEqual(
    translationMetadataSchema.parse({
      labels: [" PRÜFEN ", "prüfen", "ＱＡ"],
      variables: ["{{ name }}", "{{ name }}"],
      note: "Notiz\nZeile",
    }),
    {
      labels: ["prüfen", "qa"],
      variables: ["{{ name }}"],
      note: "Notiz\nZeile",
    },
  );
});
test("metadata rejects malformed, oversized and unknown fields", () => {
  const valid = { labels: [], variables: [], note: "" };
  for (const patch of [
    { labels: [""] },
    { labels: ["x\nsecret"] },
    { labels: Array(21).fill("a") },
    { variables: Array(51).fill("%s") },
    { note: "\0" },
    { note: "x".repeat(2001) },
    { admin: true },
  ]) {
    assert.equal(
      translationMetadataSchema.safeParse({ ...valid, ...patch }).success,
      false,
    );
  }
});
test("variable suggestions preserve exact tokens and ignore escaped printf and prose", () => {
  assert.deepEqual(
    detectTranslationVariables(
      "Hallo {{ name }} ${user} {count} %1$s %d %%s {count}",
    ),
    ["${user}", "%1$s", "%d", "{count}", "{{ name }}"].sort(),
  );
  assert.deepEqual(
    detectTranslationVariables(
      "Normaler Text, 50% Rabatt, { count, plural, one {eins} }",
    ),
    ["{eins}"],
  );
});
