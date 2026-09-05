import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectReportedTypes,
  REPORTED_TYPE_GROUPS,
  WordType,
} from "./translation-reported-types";
import { STATIC_MESSAGES } from "./static-messages";

test("only explicit supported integer types are recorded, without coercion or guessing", () => {
  const invalid = [
    undefined,
    null,
    "1",
    true,
    -1,
    11,
    1.5,
    NaN,
    Infinity,
    {},
    [],
  ];
  assert.deepEqual(
    collectReportedTypes(
      invalid.map((t) => ({ t })),
      invalid.map(() => "image.png"),
    ),
    [],
  );
  assert.deepEqual(collectReportedTypes([{ t: 6 }], [""]), []);
  assert.equal(
    collectReportedTypes(
      Object.values(WordType).map((t) => ({ t })),
      Array(11).fill("hash"),
    ).length,
    11,
  );
});
test("duplicate hashes retain every reported type once", () => {
  assert.deepEqual(
    collectReportedTypes(
      [{ t: 1 }, { t: 6 }, { t: 1 }, { t: 0 }],
      ["same", "same", "same", "other"],
    ),
    [
      { hash: "same", wordType: 1 },
      { hash: "same", wordType: 6 },
      { hash: "other", wordType: 0 },
    ],
  );
  assert.ok(REPORTED_TYPE_GROUPS.text.includes(WordType.IMG_ALT));
  assert.deepEqual(
    Object.values(REPORTED_TYPE_GROUPS)
      .flat()
      .sort((a, b) => a - b),
    Object.values(WordType),
  );
});
test("reported-type UI copy exists in every catalogue", () => {
  for (const [locale, messages] of Object.entries(STATIC_MESSAGES)) {
    if (locale === "en") continue;
    for (const key of [
      "Reported content type",
      "Text",
      "Media / documents",
      "External links",
      "Other",
      "Unknown",
      "Types are reported by clients, not inferred. Multiple types can apply; older entries may be unknown.",
    ])
      assert.ok(messages[key]?.trim(), `${locale}: ${key}`);
  }
});
