import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

const sourceRoots = [
  join(process.cwd(), "src"),
  join(process.cwd(), "wordpress-plugin", "deepglot"),
];
const thisFile = "brand-color-acceptance.test.ts";
const forbiddenVioletTokens = /(?:indigo|purple|violet|fuchsia)|#(?:4f46e5|4338ca|8b5cf6|a78bfa)|rgba\(79,\s*70,\s*229/i;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    if (![".css", ".js", ".php", ".ts", ".tsx"].includes(extname(entry.name)) || entry.name === thisFile) {
      return [];
    }

    return [path];
  });
}

test("the application uses the orange brand palette instead of violet accents", () => {
  const offendingFiles = sourceRoots.flatMap(sourceFiles).filter((file) =>
    forbiddenVioletTokens.test(readFileSync(file, "utf8"))
  );

  assert.deepEqual(offendingFiles, []);

  const globalStyles = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  assert.match(globalStyles, /--color-brand-500:\s*#f03b22/);
  assert.match(globalStyles, /--color-brand-600:\s*#df351c/);
  assert.match(globalStyles, /--color-brand-700:\s*#c62812/);
});
