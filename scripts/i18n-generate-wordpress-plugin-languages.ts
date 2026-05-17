import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type WordPressLocale = {
  googleLocale: string;
  wpLocale: string;
};

type PotEntry = {
  comments: string[];
  msgctxt?: string;
  msgid: string;
};

type TranslationCache = Record<string, Record<string, string>>;

const ROOT = process.cwd();
const PLUGIN_DIR = path.join(ROOT, "wordpress-plugin/deepglot");
const LANG_DIR = path.join(PLUGIN_DIR, "languages");
const POT_FILE = path.join(LANG_DIR, "deepglot.pot");
const CACHE_FILE = path.join(ROOT, "output/wp-plugin-translations.json");
const GOOGLE_SPLIT_TOKEN = "__DG_WP_COPY_SPLIT__";

const WORDPRESS_LOCALES: WordPressLocale[] = [
  { googleLocale: "en", wpLocale: "en_US" },
  { googleLocale: "bg", wpLocale: "bg_BG" },
  { googleLocale: "hr", wpLocale: "hr" },
  { googleLocale: "cs", wpLocale: "cs_CZ" },
  { googleLocale: "da", wpLocale: "da_DK" },
  { googleLocale: "nl", wpLocale: "nl_NL" },
  { googleLocale: "et", wpLocale: "et" },
  { googleLocale: "fi", wpLocale: "fi" },
  { googleLocale: "fr", wpLocale: "fr_FR" },
  { googleLocale: "de", wpLocale: "de_DE" },
  { googleLocale: "el", wpLocale: "el" },
  { googleLocale: "hu", wpLocale: "hu_HU" },
  { googleLocale: "ga", wpLocale: "ga" },
  { googleLocale: "it", wpLocale: "it_IT" },
  { googleLocale: "lv", wpLocale: "lv" },
  { googleLocale: "lt", wpLocale: "lt_LT" },
  { googleLocale: "mt", wpLocale: "mt_MT" },
  { googleLocale: "pl", wpLocale: "pl_PL" },
  { googleLocale: "pt", wpLocale: "pt_PT" },
  { googleLocale: "ro", wpLocale: "ro_RO" },
  { googleLocale: "sk", wpLocale: "sk_SK" },
  { googleLocale: "sl", wpLocale: "sl_SI" },
  { googleLocale: "es", wpLocale: "es_ES" },
  { googleLocale: "sv", wpLocale: "sv_SE" },
];

function readCache(): TranslationCache {
  if (!fs.existsSync(CACHE_FILE)) return {};
  return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as TranslationCache;
}

function writeCache(cache: TranslationCache) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`);
}

function makePot() {
  fs.mkdirSync(LANG_DIR, { recursive: true });
  execFileSync(
    "wp",
    ["i18n", "make-pot", PLUGIN_DIR, POT_FILE, "--domain=deepglot"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        WP_CLI_PHP_ARGS:
          "-d error_reporting=E_ALL&~E_DEPRECATED&~E_USER_DEPRECATED",
      },
    }
  );
}

function poUnescape(value: string) {
  return JSON.parse(value) as string;
}

function poEscape(value: string) {
  return JSON.stringify(value);
}

function parseStringBlock(lines: string[], startIndex: number) {
  const firstLine = lines[startIndex];
  const firstValue = firstLine.replace(/^[a-z_]+(?:\[\d+\])?\s+/, "");
  let value = poUnescape(firstValue);
  let nextIndex = startIndex + 1;

  while (nextIndex < lines.length && lines[nextIndex].startsWith('"')) {
    value += poUnescape(lines[nextIndex]);
    nextIndex += 1;
  }

  return { value, nextIndex };
}

function parsePot(content: string): PotEntry[] {
  return content
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const entry: PotEntry = { comments: [], msgid: "" };

      for (let index = 0; index < lines.length; ) {
        const line = lines[index];
        if (line.startsWith("#")) {
          entry.comments.push(line);
          index += 1;
          continue;
        }

        if (line.startsWith("msgctxt ")) {
          const parsed = parseStringBlock(lines, index);
          entry.msgctxt = parsed.value;
          index = parsed.nextIndex;
          continue;
        }

        if (line.startsWith("msgid ")) {
          const parsed = parseStringBlock(lines, index);
          entry.msgid = parsed.value;
          index = parsed.nextIndex;
          continue;
        }

        index += 1;
      }

      return entry;
    })
    .filter((entry) => entry.msgid !== "");
}

function protectTokens(text: string) {
  const tokens: string[] = [];
  const tokenPattern =
    /Deepglot|WordPress|WooCommerce|Weglot|wp_mail|REST API|API-Keys?|CSS|ISO-639-1|Self-Hosting|Language-Switcher|Switcher|Shortcode|PHP|HTML|SVG|PNG|URL|URLs|ISO-Code|[a-z]+=[a-z.-]+|https?:\/\/\S+|\/[A-Za-z0-9_.~/-]+|\[[^\]]+\]|<\/?[^>]+>|%(?:\d+\$)?[sd]/g;

  return {
    protectedText: text.replace(tokenPattern, (token) => {
      const placeholder = `__DGPH${tokens.length}__`;
      tokens.push(token);
      return placeholder;
    }),
    tokens,
  };
}

function restoreTokens(text: string, tokens: string[]) {
  return tokens.reduce(
    (result, token, index) => result.replaceAll(`__DGPH${index}__`, token),
    text
  );
}

async function googleTranslateText(text: string, targetLocale: string) {
  const params = new URLSearchParams({
    client: "gtx",
    sl: "de",
    tl: targetLocale,
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

async function translateBatch(texts: string[], targetLocale: string) {
  const protectedItems = texts.map(protectTokens);
  const joined = protectedItems.map((item) => item.protectedText).join(`\n${GOOGLE_SPLIT_TOKEN}\n`);
  const translated = await googleTranslateText(joined, targetLocale);
  const parts = translated
    .split(new RegExp(`\\s*${GOOGLE_SPLIT_TOKEN}\\s*`, "g"))
    .map((part) => part.trim());

  if (parts.length !== texts.length) {
    const serial: string[] = [];
    for (const item of protectedItems) {
      serial.push(await googleTranslateText(item.protectedText, targetLocale));
      await delay(80);
    }

    return serial.map((part, index) => restoreTokens(part, protectedItems[index].tokens));
  }

  return parts.map((part, index) => restoreTokens(part, protectedItems[index].tokens));
}

async function translateMissing(
  locale: WordPressLocale,
  sourceMessages: string[],
  cache: TranslationCache
) {
  const localeCache = (cache[locale.wpLocale] ??= {});

  if (locale.googleLocale === "de") {
    for (const message of sourceMessages) {
      localeCache[message] = message;
    }
    return;
  }

  const missing = sourceMessages.filter((message) => !localeCache[message]);
  const batchSize = 20;

  for (let index = 0; index < missing.length; index += batchSize) {
    const batch = missing.slice(index, index + batchSize);
    console.log(
      `Translating ${locale.wpLocale}: ${index + 1}-${index + batch.length} of ${missing.length}`
    );
    const translated = await translateBatch(batch, locale.googleLocale);
    translated.forEach((translation, translationIndex) => {
      localeCache[batch[translationIndex]] = translation;
    });
    writeCache(cache);
    await delay(120);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderHeader(locale: WordPressLocale) {
  return [
    'msgid ""',
    'msgstr ""',
    poEscape("Project-Id-Version: Deepglot 0.7.0\n"),
    poEscape("Report-Msgid-Bugs-To: https://deepglot.ai\n"),
    poEscape("POT-Creation-Date: 2026-05-17 00:00+0000\n"),
    poEscape("PO-Revision-Date: 2026-05-17 00:00+0000\n"),
    poEscape("Last-Translator: Deepglot Machine Translation\n"),
    poEscape("Language-Team: Deepglot\n"),
    poEscape(`Language: ${locale.wpLocale}\n`),
    poEscape("MIME-Version: 1.0\n"),
    poEscape("Content-Type: text/plain; charset=UTF-8\n"),
    poEscape("Content-Transfer-Encoding: 8bit\n"),
    poEscape("Plural-Forms: nplurals=2; plural=(n != 1);\n"),
    poEscape("X-Generator: Deepglot i18n generator\n"),
  ].join("\n");
}

function renderPo(entries: PotEntry[], locale: WordPressLocale, cache: TranslationCache) {
  const localeCache = cache[locale.wpLocale] ?? {};
  const chunks = [renderHeader(locale)];

  for (const entry of entries) {
    const lines = [...entry.comments];
    if (entry.msgctxt) {
      lines.push(`msgctxt ${poEscape(entry.msgctxt)}`);
    }
    lines.push(`msgid ${poEscape(entry.msgid)}`);
    lines.push(`msgstr ${poEscape(localeCache[entry.msgid] ?? entry.msgid)}`);
    chunks.push(lines.join("\n"));
  }

  return `${chunks.join("\n\n")}\n`;
}

function compileMo(poFile: string, moFile: string) {
  execFileSync("msgfmt", ["-o", moFile, poFile], { stdio: "inherit" });
}

function makeJson() {
  execFileSync(
    "wp",
    ["i18n", "make-json", LANG_DIR, LANG_DIR, "--no-purge", "--pretty-print"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        WP_CLI_PHP_ARGS:
          "-d error_reporting=E_ALL&~E_DEPRECATED&~E_USER_DEPRECATED",
      },
    }
  );
}

async function main() {
  makePot();
  const entries = parsePot(fs.readFileSync(POT_FILE, "utf8"));
  const sourceMessages = [...new Set(entries.map((entry) => entry.msgid))].sort((a, b) =>
    a.localeCompare(b)
  );
  const cache = readCache();

  console.log(`Collected ${sourceMessages.length} WordPress plugin messages.`);

  for (const locale of WORDPRESS_LOCALES) {
    await translateMissing(locale, sourceMessages, cache);
  }

  for (const locale of WORDPRESS_LOCALES) {
    const poFile = path.join(LANG_DIR, `deepglot-${locale.wpLocale}.po`);
    const moFile = path.join(LANG_DIR, `deepglot-${locale.wpLocale}.mo`);
    fs.writeFileSync(poFile, renderPo(entries, locale, cache));
    compileMo(poFile, moFile);
  }

  makeJson();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
