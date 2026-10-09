import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseXliff, planXliffImport, serializeXliff, XliffError, XLIFF_MAX_BYTES } from "@/lib/xliff";
import { computeTranslationHash } from "@/lib/translation-hash";

const project = { projectId: "project-a", langFrom: "de", langTo: "en" };
const segment = { originalText: "Hallo {name} <b>Welt</b> & mehr", translatedText: "Hello {name} <b>world</b> & more", workflowStatus: "APPROVED" };
const valid = () => serializeXliff({ ...project, segments: [segment] });
const parse = (xml: string, expected = project) => parseXliff(new TextEncoder().encode(xml), expected);

test("XLIFF 1.2 round trip preserves variables, HTML, approval, and stable ID", () => {
  const rows = parse(valid());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, segment.originalText);
  assert.equal(rows[0].target, segment.translatedText);
  assert.equal(rows[0].approved, true);
  assert.equal(rows[0].manual, true);
  assert.match(rows[0].id, /^[a-f0-9]{32}$/);
  assert.equal(parse(valid())[0].id, rows[0].id);
});

test("machine marker survives export while invalid or edited metadata is rejected safely", () => {
  const machine = serializeXliff({ ...project, segments: [{ ...segment, workflowStatus: "MACHINE", isManual: false }] });
  assert.equal(parse(machine)[0].manual, false);
  assert.throws(() => parse(machine.replace('dg:manual="no"', 'dg:manual="maybe"')), /dg:manual/);
  assert.match(machine, /xmlns:dg="https:\/\/deepglot.ai\/ns\/xliff"/);
  assert.equal(parse(machine.replace(' dg:manual="no"', ''))[0].manual, true);
  assert.throws(() => parse(machine.replace('dg:manual="no"', 'dg:manual=""')), /dg:manual/);
  assert.equal(parse(machine.replace(' approved="no"', ''))[0].approved, false);
  assert.throws(() => parse(machine.replace('approved="no"', 'approved=""')), /approved/);
});

test("preserves legacy uppercase language hashes without changing segment IDs", () => {
  const legacyHash = computeTranslationHash(segment.originalText, "DE", "EN");
  const xml = serializeXliff({ ...project, segments: [{ ...segment, originalHash: legacyHash }] });
  assert.equal(parse(xml)[0].id, legacyHash);
});

test("XML 1.0 export preserves carriage returns and rejects unsupported controls", () => {
  const withReturns = { ...segment, originalText: "Line\r\nnext", translatedText: "Target\rnext" };
  const xml = serializeXliff({ ...project, segments: [withReturns] });
  assert.match(xml, /&#13;/);
  const [row] = parse(xml);
  assert.equal(row.source, withReturns.originalText);
  assert.equal(row.target, withReturns.translatedText);
  assert.throws(() => serializeXliff({ ...project, segments: [{ ...segment, translatedText: "bad\u0001value" }] }), /XML 1.0/);
});

test("rejects wrong project, wrong language, duplicate ID and conflicting source", () => {
  assert.throws(() => parse(valid(), { ...project, projectId: "project-b" }), /Project or language/);
  assert.throws(() => parse(valid(), { ...project, langTo: "fr" }), /Project or language/);
  assert.throws(() => parse(valid().replace("</body>", `${valid().match(/<trans-unit[\s\S]*?<\/trans-unit>/)?.[0]}</body>`)), (error) => {
    assert.ok(error instanceof XliffError);
    assert.equal(error.line, 2);
    assert.equal(error.detail, "Duplicate segment ID");
    assert.equal(error.message, "Segment 2: Duplicate segment ID");
    return true;
  });
  assert.throws(() => parse(valid().replace("Hallo", "Servus")), /Segment ID does not match/);
});

test("rejects malformed structure, invalid UTF-8, and unsupported inline XLIFF markup", () => {
  assert.throws(() => parse(valid().replace("</body>", "</body2>")), XliffError);
  assert.throws(() => parse(valid().replace("<source>", "<source><g id=\"1\">")), XliffError);
  assert.throws(() => parse(valid().replace("</source>", "</source><![CDATA[lost content]]>")), /Unexpected text/);
  assert.throws(() => parseXliff(new Uint8Array([0xff]), project), /encoded|valid/i);
});

test("rejects files above the 4 MB transport-safe limit", () => {
  assert.equal(XLIFF_MAX_BYTES, 4_000_000);
  assert.throws(() => parseXliff(new Uint8Array(XLIFF_MAX_BYTES + 1), project), /4 MB/);
});

test("rejects entity expansion, external entities and processing instructions", () => {
  for (const name of ["xxe.xlf", "expansion.xlf"]) {
    const bytes = readFileSync(`src/lib/fixtures/xliff/${name}`);
    assert.throws(() => parseXliff(bytes, project), /forbidden/);
  }
  assert.throws(() => parse(valid().replace("<?xml", "<?bad")), /forbidden/);
  assert.throws(() => parse(valid().replace("<source>", "<source>&x;")), XliffError);
});

test("preflight rejects all writes for protected text or unconfirmed approvals", () => {
  const row = parse(valid())[0];
  assert.deepEqual(planXliffImport([row], [], false), [
    { segment: 1, message: "Approval requires explicit manager confirmation" },
  ]);
  assert.deepEqual(planXliffImport([row], [{ originalHash: row.id, translatedText: "Protected", isManual: true, workflowStatus: "MACHINE" }], true), [
    { segment: 1, message: "Existing manual or approved translation differs" },
  ]);
  assert.deepEqual(planXliffImport([row], [{ originalHash: row.id, translatedText: row.target, isManual: true, workflowStatus: "APPROVED" }], true), []);
});
