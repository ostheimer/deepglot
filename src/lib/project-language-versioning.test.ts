import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const routeSource = readFileSync(
  path.join(
    process.cwd(),
    "src",
    "app",
    "api",
    "projects",
    "[projektId]",
    "languages",
    "route.ts",
  ),
  "utf8",
);
const mutationSource = readFileSync(
  path.join(process.cwd(), "src", "lib", "project-language-mutations.ts"),
  "utf8",
);

function methodBody(method: "POST" | "DELETE") {
  const marker = `export async function ${method}(`;
  const start = routeSource.indexOf(marker);
  assert.notEqual(start, -1, `languages route must export ${method}`);

  const remainder = routeSource.slice(start + marker.length);
  const nextExport = remainder.indexOf("\nexport ");
  return nextExport === -1 ? remainder : remainder.slice(0, nextExport);
}

test("target-language POST rejects the authoritative project source language before writing", () => {
  const post = methodBody("POST");

  assert.match(post, /addProjectTargetLanguages\(db,/);
  assert.match(post, /source_language_cannot_be_target/);
  assert.match(mutationSource, /originalLang:\s*true/);
  assert.match(mutationSource, /project\.originalLang\.toLowerCase\(\)/);
  assert.ok(
    mutationSource.indexOf("source_language_cannot_be_target") <
      mutationSource.indexOf("tx.projectLanguage.createMany("),
    "the source-language rejection must happen before target-language writes",
  );
});

for (const method of ["POST", "DELETE"] as const) {
  test(`${method} changes target languages and the project version with a guarded write`, () => {
    const body = methodBody(method);

    assert.match(
      body,
      method === "POST"
        ? /addProjectTargetLanguages\(db,/
        : /deleteProjectTargetLanguage\(db,/,
    );
    assert.match(mutationSource, /runProjectLanguageMutation\(/);
    assert.match(mutationSource, /lockProjectRuntimeConfiguration\(/);
    assert.match(
      mutationSource,
      /tx\.projectLanguage\.(?:createMany|deleteMany)\(/,
    );
    assert.match(mutationSource, /tx\.project\.updateMany\(/);
    assert.match(
      mutationSource,
      /where:\s*\{[\s\S]*?id:\s*projectId,[\s\S]*?updatedAt:\s*project\.updatedAt[\s\S]*?\}/,
    );
    assert.match(mutationSource, /updatedAt:/);
    assert.doesNotMatch(
      mutationSource,
      /database\.projectLanguage\.(?:createMany|deleteMany)\(/,
    );
    assert.doesNotMatch(mutationSource, /database\.project\.update\(/);
  });
}

test("target-language mutations retry guarded writes at read-committed isolation", () => {
  assert.match(mutationSource, /async function runProjectLanguageMutation/);
  assert.match(mutationSource, /database\.\$transaction\(mutation/);
  assert.match(mutationSource, /TransactionIsolationLevel\.ReadCommitted/);
  assert.doesNotMatch(mutationSource, /TransactionIsolationLevel\.Serializable/);
  assert.match(mutationSource, /isProjectRuntimeSerializationConflict\(error\)/);
  assert.match(mutationSource, /PROJECT_LANGUAGE_MUTATION_ATTEMPTS\s*=\s*3/);
});

test("DELETE removes the WordPress domain mapping in the same guarded mutation", () => {
  const languageDelete = mutationSource.indexOf("tx.projectLanguage.deleteMany(");
  const mappingDelete = mutationSource.indexOf("tx.projectDomainMapping.deleteMany(");
  const versionWrite = mutationSource.lastIndexOf("tx.project.updateMany(");

  assert.notEqual(languageDelete, -1, "target language must be deleted");
  assert.notEqual(mappingDelete, -1, "its domain mapping must be deleted");
  assert.notEqual(versionWrite, -1, "the guarded version write must remain");
  assert.ok(
    languageDelete < mappingDelete && mappingDelete < versionWrite,
    "language and mapping deletes must precede the guarded version write",
  );
  assert.match(
    mutationSource.slice(mappingDelete, versionWrite),
    /where:\s*\{\s*projectId,\s*langCode\s*\}/,
  );
});
