import fs from "node:fs";
import path from "node:path";

export type DocsLanguageMatch = {
  line: number;
  column: number;
  match: string;
  rule: string;
  context: string;
};

export type DocsLanguageIssue = DocsLanguageMatch & {
  filePath: string;
};

export type DocsLanguageReport = {
  files: string[];
  issues: DocsLanguageIssue[];
};

const MARKDOWN_EXTENSION = ".md";

export const DOCS_LANGUAGE_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "output",
]);

const STRONG_GERMAN_MARKERS = [
  {
    rule: "German umlaut characters",
    regex: /[ÄÖÜäöüß]/g,
  },
  {
    rule: "German documentation term",
    regex:
      /\b(?:Anfrage|Antwort|Architektur|Architekturen|Dokumentation|Dokumente|Kompatibilitaet|Referenz|Referenzsystem|Schritte|Uebersetzung|Uebersetzungen|Uebersetzungs|Zielsprache|Quellsprache|unterstuetzt|enthaelt|sprachbewusst|sprachspezifisch)\b/gi,
  },
];

const GERMAN_STOP_WORDS_REGEX =
  /\b(?:aber|auch|auf|aus|bei|bereits|damit|danach|dann|das|dass|dem|den|der|des|die|diese|diesem|dieser|dieses|ein|eine|einem|einen|einer|fuer|ist|mit|nicht|noch|ohne|sind|sonst|und|werden|wird|zuerst|zu)\b/gi;

function isFenceStart(line: string): "```" | "~~~" | null {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("```")) return "```";
  if (trimmed.startsWith("~~~")) return "~~~";
  return null;
}

function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, " ");
}

function findStrongMarker(line: string): DocsLanguageMatch | null {
  for (const marker of STRONG_GERMAN_MARKERS) {
    const match = marker.regex.exec(line);
    marker.regex.lastIndex = 0;
    if (!match || match.index === undefined) {
      continue;
    }

    return {
      line: 0,
      column: match.index + 1,
      match: match[0],
      rule: marker.rule,
      context: line.trim(),
    };
  }

  return null;
}

function findStopWordCluster(line: string): DocsLanguageMatch | null {
  const matches = Array.from(line.matchAll(GERMAN_STOP_WORDS_REGEX));
  if (matches.length < 2) {
    return null;
  }

  const first = matches[0];
  if (first.index === undefined) {
    return null;
  }

  return {
    line: 0,
    column: first.index + 1,
    match: first[0],
    rule: "Multiple German stop words",
    context: line.trim(),
  };
}

export function scanMarkdownForNonEnglish(content: string): DocsLanguageMatch[] {
  const lines = content.split(/\r?\n/);
  const issues: DocsLanguageMatch[] = [];
  let openFence: "```" | "~~~" | null = null;

  lines.forEach((line, index) => {
    const fence = isFenceStart(line);
    if (fence) {
      openFence = openFence === fence ? null : openFence ?? fence;
      return;
    }

    if (openFence) {
      return;
    }

    const sanitizedLine = stripInlineCode(line);
    const strongMarker = findStrongMarker(sanitizedLine);
    const stopWordCluster = strongMarker ? null : findStopWordCluster(sanitizedLine);
    const issue = strongMarker ?? stopWordCluster;

    if (!issue) {
      return;
    }

    issues.push({
      ...issue,
      line: index + 1,
    });
  });

  return issues;
}

export function collectMarkdownFiles(rootDir: string): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (DOCS_LANGUAGE_IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }

        walk(path.join(currentDir, entry.name));
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(MARKDOWN_EXTENSION)) {
        files.push(path.join(currentDir, entry.name));
      }
    }
  }

  walk(rootDir);
  return files.sort((a, b) => a.localeCompare(b));
}

export function checkMarkdownDocumentation(rootDir: string): DocsLanguageReport {
  const files = collectMarkdownFiles(rootDir);
  const issues: DocsLanguageIssue[] = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    const fileIssues = scanMarkdownForNonEnglish(content).map((issue) => ({
      ...issue,
      filePath,
    }));
    issues.push(...fileIssues);
  }

  return { files, issues };
}
