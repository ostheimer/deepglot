import assert from "node:assert/strict";
import { test } from "node:test";
import { STATIC_MESSAGES } from "./static-messages";
import {
  observationCutoff,
  savedVariableQuality,
  translationTokenCounts,
} from "./translation-quality";

test("saved-variable checks compare exact token multiplicities, not substrings", () => {
  const cases = [
    ["Hallo {{name}}", "Hello {{name}}", ["{{name}}"], "match"],
    ["Hallo {{name}}", "Hello", ["{{name}}"], "mismatch"],
    ["{name}", "{{name}}", ["{name}"], "mismatch"],
    ["{name}", "${name}", ["{name}"], "mismatch"],
    ["%s %s", "%s", ["%s"], "mismatch"],
    ["%s", "%s %s", ["%s"], "mismatch"],
    ["%s", "%%s", ["%s"], "mismatch"],
    ["%1$s %2$d", "%2$d %1$s", ["%1$s", "%2$d"], "match"],
    ["{{ name }}", "{{name}}", ["{{ name }}"], "mismatch"],
    ["{name}", "{Name}", ["{name}"], "mismatch"],
    ["{removed}", "{name}", ["{name}"], "mismatch"],
    ["{name}", "Hello", [], "unchecked"],
  ] as const;
  for (const [source, target, variables, expected] of cases) {
    assert.equal(savedVariableQuality(source, target, variables), expected);
  }
  assert.deepEqual([...translationTokenCounts("%% %s %%s %s")], [["%s", 2]]);
});

test("observation window is thirty exact days in UTC, independent of DST", () => {
  assert.equal(
    observationCutoff(new Date("2026-04-05T12:00:00Z")).toISOString(),
    "2026-03-06T12:00:00.000Z",
  );
});

test("quality and observation controls have copy in every supported catalogue", () => {
  const keys = [
    "Saved variable check",
    "All check states",
    "Variable mismatch",
    "Selected variables preserved",
    "No variables selected",
    "Observed activity",
    "All observation states",
    "Seen in the last 30 days",
    "Last seen over 30 days ago",
    "Never observed by SaaS",
    "Checks cover selected variables only. Observations exclude local cache hits and do not prove inactivity.",
  ];
  for (const [locale, messages] of Object.entries(STATIC_MESSAGES)) {
    if (locale === "en") continue;
    for (const key of keys)
      assert.ok(messages[key]?.trim(), `${locale}: ${key}`);
  }
  assert.equal(
    STATIC_MESSAGES.de?.[keys[0]],
    "Prüfung gespeicherter Variablen",
  );
});
