import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_EXCLUSION_CSV_ROWS,
  parseExclusionCsv,
  planExclusionImport,
  serializeExclusionCsv,
} from "@/lib/exclusion-csv";

test("exclusion CSV round-trips runtime URL wildcards, PCRE, Unicode names and formula guards", () => {
  const rows = [
    { type: "URL" as const, value: "/produkte/*" },
    { type: "URL" as const, value: '/angebote,"neu"' },
    { type: "URL" as const, value: "'=offer" },
    { type: "REGEX" as const, value: "(?<=/en)/preise" },
    { type: "REGEX" as const, value: "\\Q(foo\\E" },
    { type: "CSS_CLASS" as const, value: "übersetzung-sperren" },
    { type: "CSS_CLASS" as const, value: "a.b:aktiv" },
    { type: "CSS_ID" as const, value: "hero_日本" },
    { type: "CSS_ID" as const, value: "cafe\u0301" },
  ];
  const csv = serializeExclusionCsv(rows);
  const parsed = parseExclusionCsv(`\uFEFF${csv}`);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.rows.map((row) => ({ type: row.type, value: row.value })), rows);
  assert.match(csv, /''=offer/u);
});

test("exclusion CSV reports row errors and never plans invalid rows", () => {
  const parsed = parseExclusionCsv([
    "type,value",
    "URL,/kontakt",
    "CSS_CLASS,.mit leerzeichen",
    "REGEX,([",
    "CSS_ID,#gültig",
    "URL,",
    "BOGUS,foo",
    "URL,/x,unexpected",
  ].join("\r\n"));
  assert.deepEqual(parsed.rows.map((row) => row.line), [2, 3, 4, 5]);
  assert.deepEqual(parsed.issues.map((issue) => issue.line), [6, 7, 8]);
  assert.equal(parseExclusionCsv('type,value\nURL,"unfinished').issues[0].message, "Unclosed quoted value");
  assert.equal(parseExclusionCsv("wrong,value\nURL,/x").issues[0].line, 1);
  assert.equal(parseExclusionCsv(`type,value\nURL,${"x".repeat(2001)}`).issues[0].line, 2);
  assert.equal(parseExclusionCsv("type,value\nURL,abc\u0000def").issues[0].line, 2);
});

test("exclusion import plan skips existing rules and reports duplicate CSV rows", () => {
  const { rows, issues } = parseExclusionCsv("type,value\nURL,/kontakt\nCSS_CLASS,.übersetzung\nCSS_CLASS,übersetzung");
  assert.deepEqual(issues, []);
  const plan = planExclusionImport(rows, [{ type: "URL", value: "/kontakt" }]);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.skips.length, 1);
  assert.deepEqual(plan.conflicts, [{ line: 4, message: "Duplicate rule in CSV" }]);
  const repeated = planExclusionImport(rows.slice(0, 2), [
    { type: "URL", value: "/kontakt" },
    { type: "CSS_CLASS", value: "übersetzung" },
  ]);
  assert.equal(repeated.creates.length, 0);
  assert.equal(repeated.skips.length, 2);
});

test("an exported legacy CSS rule can be reimported into its existing project", () => {
  const existing = [{ type: "CSS_CLASS" as const, value: "foo bar" }];
  const parsed = parseExclusionCsv(serializeExclusionCsv(existing));
  const plan = planExclusionImport(parsed.rows, existing);
  assert.deepEqual(parsed.issues, []);
  assert.equal(plan.skips.length, 1);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(planExclusionImport(parsed.rows, []).creates.length, 1);
});

test("exclusion CSV row cap is bounded", () => {
  const content = ["type,value", ...Array.from({ length: MAX_EXCLUSION_CSV_ROWS + 1 }, (_, i) => `URL,/p${i}`)].join("\n");
  const parsed = parseExclusionCsv(content);
  assert.equal(parsed.rows.length, MAX_EXCLUSION_CSV_ROWS);
  assert.deepEqual(parsed.issues.at(-1), { line: MAX_EXCLUSION_CSV_ROWS + 2, message: `Maximum ${MAX_EXCLUSION_CSV_ROWS} rows per import` });
});

test("malformed quotes cannot produce an unbounded error report", () => {
  const parsed = parseExclusionCsv(`type,value\nURL,a${'"'.repeat(3000)}`);
  assert.equal(parsed.issues.length, 101);
  assert.deepEqual(parsed.issues.at(-1), { line: 2, message: "Too many CSV errors; fix the first 100" });
});
