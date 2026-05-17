import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import dotenv from "dotenv";

import { SITE_LOCALES, type SiteLocale } from "@/lib/site-locale";
import { translateTexts } from "@/lib/translation";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");
const OUTPUT_FILE = path.join(ROOT, "src/lib/static-messages.ts");
const CACHE_FILE = path.join(ROOT, "output/static-message-translations.json");

type MessageEntry = {
  en: string;
  de?: string;
};

type TranslationCache = Partial<Record<SiteLocale, Record<string, string>>>;

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

const GOOGLE_SPLIT_TOKEN = "__DG_STATIC_COPY_SPLIT__";

dotenv.config({ path: path.join(ROOT, ".env.production.local"), override: false, quiet: true });
dotenv.config({ path: path.join(ROOT, ".env.preview.local"), override: false, quiet: true });
dotenv.config({ path: path.join(ROOT, ".env.development.local"), override: false, quiet: true });
dotenv.config({ path: path.join(ROOT, ".env.local"), override: false, quiet: true });
dotenv.config({ path: path.join(ROOT, ".env"), override: false, quiet: true });

if (process.env.GEMINI_API_KEY) {
  process.env.TRANSLATION_PROVIDER = "gemini";
}

function listSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }

    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
}

function staticString(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  const value = unwrap(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text;
  }
  return null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

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

function addMessage(messages: Map<string, MessageEntry>, english: string, german?: string) {
  if (isTechnicalString(english)) return;
  const current = messages.get(english);
  messages.set(english, {
    en: english,
    de: current?.de ?? german,
  });
}

function collectStringsFromNode(
  node: ts.Node,
  messages: Map<string, MessageEntry>,
  skippedKey: string | null = null
) {
  if (
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    !SKIP_KEYS.has(skippedKey ?? "")
  ) {
    addMessage(messages, node.text);
    return;
  }

  if (ts.isPropertyAssignment(node)) {
    const key = propertyNameText(node.name);
    if (key && SKIP_KEYS.has(key)) {
      return;
    }
    collectStringsFromNode(node.initializer, messages, key);
    return;
  }

  ts.forEachChild(node, (child) => collectStringsFromNode(child, messages, skippedKey));
}

function collectMessages() {
  const messages = new Map<string, MessageEntry>();

  for (const filePath of listSourceFiles(SRC_DIR)) {
    const source = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    function visit(node: ts.Node) {
      if (ts.isPropertyAssignment(node) && propertyNameText(node.name) === "en") {
        collectStringsFromNode(node.initializer, messages);
      }

      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (node.expression.text === "uiText") {
          const english = staticString(node.arguments[1]);
          const german = staticString(node.arguments[2]);
          if (english) addMessage(messages, english, german ?? undefined);
        }

        if (node.expression.text === "t") {
          const german = staticString(node.arguments[1]);
          const english = staticString(node.arguments[2]);
          if (english) addMessage(messages, english, german ?? undefined);
        }

        if (node.expression.text === "localizeCopy") {
          const copyIdentifier = node.arguments[1];
          if (copyIdentifier && ts.isIdentifier(copyIdentifier)) {
            const declaration = findVariableDeclaration(sourceFile, copyIdentifier.text);
            const englishNode = declaration ? findObjectProperty(declaration.initializer, "en") : null;
            if (englishNode) {
              collectStringsFromNode(englishNode, messages);
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return [...messages.values()].sort((a, b) => a.en.localeCompare(b.en));
}

function findVariableDeclaration(sourceFile: ts.SourceFile, name: string): ts.VariableDeclaration | null {
  let found: ts.VariableDeclaration | null = null;

  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function findObjectProperty(node: ts.Node | undefined, key: string): ts.Expression | null {
  if (!node) return null;
  const expression = ts.isAsExpression(node) ? node.expression : node;
  if (!ts.isObjectLiteralExpression(expression)) return null;

  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.name) === key) {
      return property.initializer;
    }
  }

  return null;
}

function readCache(): TranslationCache {
  if (!fs.existsSync(CACHE_FILE)) return {};
  return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as TranslationCache;
}

function writeCache(cache: TranslationCache) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`);
}

async function translateMissing(
  locale: SiteLocale,
  englishMessages: string[],
  cache: TranslationCache
) {
  const localeCache = (cache[locale] ??= {});
  const missing = englishMessages.filter((message) => !localeCache[message]);
  const batchSize = process.argv.includes("--public-google") ? 35 : 150;

  for (let index = 0; index < missing.length; index += batchSize) {
    const batch = missing.slice(index, index + batchSize);
    console.log(`Translating ${locale}: ${index + 1}-${index + batch.length} of ${missing.length}`);

    const translated = process.argv.includes("--public-google")
      ? await translateWithPublicGoogle(batch, locale)
      : await translateTexts({
          texts: batch,
          sourceLang: "en",
          targetLang: locale,
        });

    translated.forEach((result, resultIndex) => {
      localeCache[batch[resultIndex]] = result.text;
    });
    writeCache(cache);
  }
}

function protectPlaceholders(text: string) {
  const placeholders: string[] = [];
  const protectedText = text.replace(/\{[a-zA-Z0-9_]+\}/g, (placeholder) => {
    const token = `__DGPH${placeholders.length}__`;
    placeholders.push(placeholder);
    return token;
  });

  return { protectedText, placeholders };
}

function restorePlaceholders(text: string, placeholders: string[]) {
  return placeholders.reduce(
    (result, placeholder, index) => result.replaceAll(`__DGPH${index}__`, placeholder),
    text
  );
}

async function translateWithPublicGoogle(texts: string[], locale: SiteLocale) {
  const protectedItems = texts.map(protectPlaceholders);
  const joined = protectedItems.map((item) => item.protectedText).join(`\n${GOOGLE_SPLIT_TOKEN}\n`);
  const translated = await googleTranslateText(joined, locale);
  const parts = translated
    .split(new RegExp(`\\s*${GOOGLE_SPLIT_TOKEN}\\s*`, "g"))
    .map((part) => part.trim());

  if (parts.length !== texts.length) {
    const serial: Array<{ text: string }> = [];
    for (const item of protectedItems) {
      serial.push({ text: await googleTranslateText(item.protectedText, locale) });
      await delay(80);
    }
    return serial.map((item, index) => ({
      text: restorePlaceholders(item.text, protectedItems[index].placeholders),
    }));
  }

  return parts.map((part, index) => ({
    text: restorePlaceholders(part, protectedItems[index].placeholders),
  }));
}

async function googleTranslateText(text: string, locale: SiteLocale) {
  const params = new URLSearchParams({
    client: "gtx",
    sl: "en",
    tl: locale,
    dt: "t",
    q: text,
  });
  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`);
  if (!response.ok) {
    throw new Error(`Google Translate fallback failed with ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
    throw new Error("Google Translate fallback returned an unexpected payload.");
  }

  return payload[0]
    .map((part) => (Array.isArray(part) && typeof part[0] === "string" ? part[0] : ""))
    .join("");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderStaticMessages(messages: MessageEntry[], cache: TranslationCache) {
  const englishMessages = messages.map((message) => message.en);
  const output: TranslationCache = {
    en: {},
    de: {},
  };

  for (const message of messages) {
    if (message.de) {
      output.de![message.en] = message.de;
    }
  }

  for (const locale of SITE_LOCALES) {
    if (locale === "en" || locale === "de") continue;
    output[locale] = {};
    for (const english of englishMessages) {
      output[locale]![english] = cache[locale]?.[english] ?? english;
    }
  }

  return `import type { SiteLocale } from "@/lib/site-locale";

export const STATIC_MESSAGES: Partial<Record<SiteLocale, Record<string, string>>> = ${JSON.stringify(output, null, 2)};
`;
}

async function main() {
  const messages = collectMessages();
  const englishMessages = messages.map((message) => message.en);
  const cache = readCache();

  console.log(`Collected ${englishMessages.length} English source messages.`);

  for (const locale of SITE_LOCALES) {
    if (locale === "en" || locale === "de") continue;
    await translateMissing(locale, englishMessages, cache);
  }

  fs.writeFileSync(OUTPUT_FILE, renderStaticMessages(messages, cache));
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_FILE)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
