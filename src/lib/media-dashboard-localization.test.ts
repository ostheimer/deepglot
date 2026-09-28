import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { STATIC_MESSAGES } from "./static-messages";
import { SITE_LOCALES } from "./site-locale";

test("every media-manager message has a catalogue entry in supported non-English locales", () => {
  const source = ts.createSourceFile(
    "media-manager.tsx",
    readFileSync("src/components/projekte/media-manager.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const keys = new Set<string>();
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t" &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      keys.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(keys.size > 30);
  // German messages are provided inline; other locales use the catalogue.
  const missing = SITE_LOCALES
    .filter((locale) => locale !== "en" && locale !== "de")
    .flatMap((locale) =>
      [...keys]
        .filter((key) => !STATIC_MESSAGES[locale]?.[key]?.trim())
        .map((key) => `${locale}: ${key}`),
    );
  assert.deepEqual(missing, [], "media messages must not silently fall back to English");
});
