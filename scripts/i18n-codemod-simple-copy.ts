import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");

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

function readStaticString(node: ts.Expression): string | null {
  const value = unwrap(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text;
  }
  return null;
}

function isNonCopyString(value: string) {
  return (
    value === "" ||
    value.startsWith("/") ||
    value.startsWith("#") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("mailto:") ||
    /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value) ||
    /^[A-Z]{2,}$/.test(value)
  );
}

function getLocaleIdentifierFromGermanCheck(node: ts.Expression): string | null {
  const condition = unwrap(node);
  if (!ts.isBinaryExpression(condition)) return null;
  if (
    condition.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    condition.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken
  ) {
    return null;
  }

  const left = unwrap(condition.left);
  const right = unwrap(condition.right);

  if (ts.isIdentifier(left) && ts.isStringLiteral(right) && right.text === "de") {
    return left.text;
  }

  if (ts.isStringLiteral(left) && left.text === "de" && ts.isIdentifier(right)) {
    return right.text;
  }

  return null;
}

function quote(value: string) {
  return JSON.stringify(value);
}

function hasStaticCopyImport(source: string) {
  return source.includes("@/lib/static-copy");
}

function addStaticCopyImport(source: string) {
  if (hasStaticCopyImport(source)) return source;

  const sourceFile = ts.createSourceFile("file.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  if (imports.length === 0) {
    return `import { uiText } from "@/lib/static-copy";\n${source}`;
  }

  const lastImport = imports[imports.length - 1];
  return `${source.slice(0, lastImport.end)}\nimport { uiText } from "@/lib/static-copy";${source.slice(lastImport.end)}`;
}

function transformFile(filePath: string, dryRun: boolean) {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  function visit(node: ts.Node) {
    if (ts.isConditionalExpression(node)) {
      const localeIdentifier = getLocaleIdentifierFromGermanCheck(node.condition);
      const german = readStaticString(node.whenTrue);
      const english = readStaticString(node.whenFalse);

      if (
        localeIdentifier &&
        german !== null &&
        english !== null &&
        !isNonCopyString(german) &&
        !isNonCopyString(english)
      ) {
        replacements.push({
          start: node.getStart(sourceFile),
          end: node.end,
          text: `uiText(${localeIdentifier}, ${quote(english)}, ${quote(german)})`,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (replacements.length === 0) {
    return { filePath, count: 0 };
  }

  let output = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`;
  }
  output = addStaticCopyImport(output);

  if (!dryRun) {
    fs.writeFileSync(filePath, output);
  }

  return { filePath, count: replacements.length };
}

const dryRun = process.argv.includes("--dry-run");
const results = listSourceFiles(SRC_DIR)
  .map((filePath) => transformFile(filePath, dryRun))
  .filter((result) => result.count > 0);

const total = results.reduce((sum, result) => sum + result.count, 0);
for (const result of results) {
  console.log(`${path.relative(ROOT, result.filePath)}: ${result.count}`);
}
console.log(`${dryRun ? "Would replace" : "Replaced"} ${total} simple localized string ternaries.`);
