import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, "src/app/api");

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function addImport(source: string, statement: string) {
  if (source.includes(statement)) return source;
  const importMatches = [...source.matchAll(/^import .+;$/gm)];
  if (importMatches.length === 0) return `${statement}\n${source}`;
  const last = importMatches[importMatches.length - 1];
  const end = (last.index ?? 0) + last[0].length;
  return `${source.slice(0, end)}\n${statement}${source.slice(end)}`;
}

let changed = 0;

for (const filePath of listFiles(API_DIR)) {
  let source = fs.readFileSync(filePath, "utf8");
  const original = source;

  source = source.replace(
    /function t\(locale: "en" \| "de", deText: string, enText: string\) \{\n\s*return locale === "de" \? deText : enText;\n\}/g,
    `function t(locale: SiteLocale, deText: string, enText: string) {\n  return uiText(locale, enText, deText);\n}`
  );
  source = source.replace(/locale: "en" \| "de"/g, "locale: SiteLocale");

  if (source !== original) {
    source = addImport(source, 'import type { SiteLocale } from "@/lib/site-locale";');
    source = addImport(source, 'import { uiText } from "@/lib/static-copy";');
    fs.writeFileSync(filePath, source);
    changed += 1;
    console.log(path.relative(ROOT, filePath));
  }
}

console.log(`Updated ${changed} API files.`);
