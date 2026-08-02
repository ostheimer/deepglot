import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import { SITE_LOCALES } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";
import { STATIC_MESSAGES } from "@/lib/static-messages";

const SRC_DIR = path.join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath);
    if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith(".test.ts")) return [];
    return [filePath];
  });
}

function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
}

function staticString(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  const value = unwrap(node);
  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)
    ? value.text
    : null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : null;
}

const SKIP_KEYS = new Set([
  "href",
  "id",
  "icon",
  "value",
  "provider",
  "model",
  "baseUrl",
  "apiKey",
  "className",
]);

function isTechnicalString(value: string) {
  return (
    value.trim() === "" ||
    value.startsWith("/") ||
    value.startsWith("#") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("mailto:") ||
    /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value) ||
    /^[a-z0-9_-]+$/.test(value) ||
    /^[A-Z0-9_-]+$/.test(value)
  );
}

function collectStringsFromNode(
  node: ts.Node,
  messages: Set<string>,
  skippedKey: string | null = null
) {
  if (
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    !SKIP_KEYS.has(skippedKey ?? "") &&
    !isTechnicalString(node.text)
  ) {
    messages.add(node.text);
    return;
  }

  if (ts.isPropertyAssignment(node)) {
    const key = propertyNameText(node.name);
    if (key && SKIP_KEYS.has(key)) return;
    collectStringsFromNode(node.initializer, messages, key);
    return;
  }

  ts.forEachChild(node, (child) => collectStringsFromNode(child, messages, skippedKey));
}

function collectGeneratedEnglishMessages() {
  const messages = new Set<string>();

  for (const filePath of sourceFiles(SRC_DIR)) {
    const sourceFile = ts.createSourceFile(
      filePath,
      readFileSync(filePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    function visit(node: ts.Node) {
      if (ts.isPropertyAssignment(node) && propertyNameText(node.name) === "en") {
        collectStringsFromNode(node.initializer, messages);
      }

      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const argumentIndex = node.expression.text === "t" ? 2 : 1;
        if (node.expression.text === "uiText" || node.expression.text === "t") {
          const english = staticString(node.arguments[argumentIndex]);
          if (english && !isTechnicalString(english)) messages.add(english);
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return [...messages];
}

test("all generated public UI messages exist in every non-English catalogue", () => {
  const messages = collectGeneratedEnglishMessages();
  const missing: string[] = [];

  for (const locale of SITE_LOCALES) {
    if (locale === "en" || locale === "de") continue;
    const catalogue = STATIC_MESSAGES[locale] ?? {};
    for (const message of messages) {
      if (!Object.hasOwn(catalogue, message)) missing.push(`${locale}: ${message}`);
    }
  }

  assert.deepEqual(missing, []);
});

test("German pricing proof makes only plan-backed claims", () => {
  const source = readFileSync(
    path.join(SRC_DIR, "components", "marketing", "marketing-home.tsx"),
    "utf8"
  );

  assert.doesNotMatch(source, /Kein Abo-Zwang/);
  assert.doesNotMatch(source, /Du zahlst nur für das, was du nutzt/);
  assert.match(source, /Klare Tarife, transparente Limits, volle Kostenkontrolle\./);
});

test("auth free-word proof derives from the canonical FREE plan", () => {
  const source = readFileSync(path.join(SRC_DIR, "app", "(auth)", "layout.tsx"), "utf8");

  assert.match(source, /BILLING_PLANS\.FREE\.wordsLimit/);
  assert.match(source, /formatNumber\([^)]*BILLING_PLANS\.FREE\.wordsLimit/);
  assert.doesNotMatch(source, /10[,.]000 words per month free/);
  assert.doesNotMatch(source, /10[.]000 Wörter pro Monat kostenlos/);
});

test("showcase image alternative text follows the selected locale", () => {
  const source = readFileSync(
    path.join(SRC_DIR, "components", "marketing", "hero-language-preview.tsx"),
    "utf8"
  );

  assert.match(source, /alt=\{uiText\(\s*locale,/);
  assert.doesNotMatch(
    source,
    /alt="Modernes österreichisches Architekturprojekt mit warmem Holz und großen Fenstern"/
  );
});

test("marketing hero title can wrap long localized words on mobile", () => {
  const source = readFileSync(
    path.join(SRC_DIR, "components", "marketing", "marketing-home.tsx"),
    "utf8"
  );
  const heroHeadingClass = source.match(/<h1 className="([^"]+)"/)?.[1] ?? "";
  const dutchTitle = uiText(
    "nl",
    "Translate your WordPress site without subscription lock-in",
    "Übersetze deine WordPress-Site ohne Abo-Falle"
  );

  assert.match(dutchTitle, /abonnementsvergrendeling/);
  assert.match(heroHeadingClass, /\[overflow-wrap:anywhere\]|break-words/);
  assert.match(heroHeadingClass, /hyphens-auto/);
});
