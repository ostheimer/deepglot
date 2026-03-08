import path from "node:path";

import { checkMarkdownDocumentation } from "../src/lib/docs-language";

const { files, issues } = checkMarkdownDocumentation(process.cwd());

if (issues.length === 0) {
  console.log(`Documentation language check passed for ${files.length} Markdown files.`);
  process.exit(0);
}

console.error("Documentation language check failed. Markdown documentation must stay in English.");

for (const issue of issues) {
  const relativePath = path.relative(process.cwd(), issue.filePath);
  console.error(
    `${relativePath}:${issue.line}:${issue.column} ${issue.rule} -> "${issue.match}" | ${issue.context}`
  );
}

process.exit(1);
