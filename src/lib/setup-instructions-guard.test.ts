import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Guardrail for the project setup instructions (#170).
//
// The setup page once rendered a copy-paste script snippet pointing at
// https://cdn.deepglot.com/v1/deepglot.js — a host that does not resolve
// (neither does cdn.deepglot.ai). A user following the visible instructions
// hit a dead URL on the very first step. The universal (non-WordPress)
// runtime snippet is tracked in #121 and must not be advertised with a
// concrete URL until the script is actually published and reachable.
//
// This test sweeps the app source and root documentation for any
// `cdn.deepglot` host reference so the dead snippet cannot drift back in.

const SCAN_ROOTS = ["src"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".md", ".php"]);
const FORBIDDEN_HOST = /cdn\.deepglot\./i;

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);

    if (statSync(fullPath).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) {
        return [];
      }
      return collectFiles(fullPath);
    }

    return SCAN_EXTENSIONS.has(path.extname(entry)) ? [fullPath] : [];
  });
}

test("no source or docs reference the unreachable cdn.deepglot host (#170)", () => {
  const rootMarkdown = readdirSync(process.cwd())
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => path.join(process.cwd(), entry));

  const files = [
    ...SCAN_ROOTS.flatMap((root) => collectFiles(path.join(process.cwd(), root))),
    ...rootMarkdown,
  ];

  const offenders = files
    .filter((filePath) => !filePath.endsWith("setup-instructions-guard.test.ts"))
    .flatMap((filePath) => {
      const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

      return lines
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ line }) => FORBIDDEN_HOST.test(line))
        .map(
          ({ line, lineNumber }) =>
            `${path.relative(process.cwd(), filePath)}:${lineNumber}: ${line.trim().slice(0, 120)}`
        );
    });

  assert.deepEqual(
    offenders,
    [],
    "cdn.deepglot.* does not resolve — do not advertise it in setup instructions or docs (#170, #121)"
  );
});

test("setup page keeps a working install path and gates the JS snippet on #121", () => {
  const setupPage = readFileSync(
    path.join(
      process.cwd(),
      "src",
      "app",
      "(dashboard)",
      "projekte",
      "[projektId]",
      "einstellungen",
      "setup",
      "page.tsx"
    ),
    "utf8"
  );

  // The WordPress plugin remains the documented, working install path.
  assert.match(setupPage, /wordpress-plugin\/deepglot|Deepglot.*[Pp]lugin/);

  // No concrete runtime-script URL until the universal snippet ships (#121).
  assert.doesNotMatch(setupPage, /<script[^>]*src=.*deepglot\.js/);
});
