import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

const WHITE = "#ffffff";
const LIGHT_CREAM = "#fff0ec";
const NAVY = "#071521";
const INTERACTION_ORANGE = "#d92f19";
const TEXT_ORANGE = "#c62812";
const DARK_SURFACE_ORANGE = "#f03b22";

function linearChannel(hex: string) {
  const channel = Number.parseInt(hex, 16) / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  const normalized = hex.replace("#", "");
  const red = linearChannel(normalized.slice(0, 2));
  const green = linearChannel(normalized.slice(2, 4));
  const blue = linearChannel(normalized.slice(4, 6));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath);
    return [".css", ".js", ".php", ".ts", ".tsx"].includes(extname(entry.name)) &&
      !entry.name.endsWith(".test.ts")
      ? [filePath]
      : [];
  });
}

test("orange interaction and small-text colors meet WCAG AA contrast", () => {
  assert.ok(contrast(INTERACTION_ORANGE, WHITE) >= 4.5);
  assert.ok(contrast(TEXT_ORANGE, LIGHT_CREAM) >= 4.5);
  assert.ok(contrast(DARK_SURFACE_ORANGE, NAVY) >= 4.5);

  const globalStyles = readFileSync(
    join(process.cwd(), "src", "app", "globals.css"),
    "utf8"
  );
  assert.match(globalStyles, /--color-brand-600:\s*#d92f19/);
  assert.match(globalStyles, /--primary:\s*#d92f19/);
  assert.match(globalStyles, /--sidebar-primary:\s*#d92f19/);
});

test("small orange developer-docs text stays readable on the navy header", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "components", "marketing", "developer-docs.tsx"),
    "utf8"
  );
  const darkHeader = source.match(
    /<header[^>]*bg-\[#071521\][\s\S]*?<\/header>/
  )?.[0];

  assert.ok(darkHeader, "developer docs must retain its navy header");
  assert.match(darkHeader, /text-\[#f03b22\]/);
  assert.doesNotMatch(darkHeader, /text-\[#c62812\]/);
});

test("hard-coded orange text and white-on-orange controls use accessible tokens", () => {
  const sources = [
    ...sourceFiles(join(process.cwd(), "src")),
    ...sourceFiles(join(process.cwd(), "wordpress-plugin", "deepglot")),
  ].map((filePath) => ({ filePath, source: readFileSync(filePath, "utf8") }));

  const darkHeaderException = join(
    process.cwd(),
    "src",
    "components",
    "marketing",
    "developer-docs.tsx"
  );
  const signalTextOccurrences = sources.flatMap(({ filePath, source }) =>
    [...source.matchAll(/text-\[#f03b22\]/g)].map(() => filePath)
  );
  assert.deepEqual(
    signalTextOccurrences,
    [darkHeaderException],
    "#f03b22 text is reserved for the tested navy header; light surfaces must use #c62812"
  );

  const unsafeSolidControls = sources.filter(({ source }) =>
    /bg-\[#f03b22\][^"\n]*text-white|text-white[^"\n]*bg-\[#f03b22\]|background:\s*#f03b22;\s*color:\s*#fff/i.test(
      source
    )
  );
  assert.deepEqual(
    unsafeSolidControls.map(({ filePath }) => filePath),
    [],
    "white-on-orange controls must use #d92f19 or darker"
  );
});
