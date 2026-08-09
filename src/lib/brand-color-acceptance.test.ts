import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

const sourceRoot = join(process.cwd(), "src");
const thisFile = "brand-color-acceptance.test.ts";
const forbiddenVioletTokens = /(?:indigo|purple|violet|fuchsia)|#(?:4f46e5|8b5cf6|a78bfa)/i;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    if (![".css", ".ts", ".tsx"].includes(extname(entry.name)) || entry.name === thisFile) {
      return [];
    }

    return [path];
  });
}

test("the application uses the orange brand palette instead of violet accents", () => {
  const offendingFiles = sourceFiles(sourceRoot).filter((file) =>
    forbiddenVioletTokens.test(readFileSync(file, "utf8"))
  );

  assert.deepEqual(offendingFiles, []);

  const globalStyles = readFileSync(join(sourceRoot, "app", "globals.css"), "utf8");
  assert.match(globalStyles, /--color-brand-500:\s*#f03b22/);
  assert.match(globalStyles, /--color-brand-600:\s*#df351c/);
  assert.match(globalStyles, /--color-brand-700:\s*#c62812/);
});
