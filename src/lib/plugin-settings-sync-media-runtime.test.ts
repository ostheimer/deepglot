import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const route = readFileSync(
  path.join(process.cwd(), "src/app/api/plugin/settings-sync/route.ts"),
  "utf8",
);

test("plugin settings sync cannot activate dormant media mappings", () => {
  assert.match(
    route,
    /const authoritativeProject = await tx\.project\.findUnique/,
  );
  assert.match(route, /findPluginMirrorConflicts\(body,/);
  assert.match(route, /buildPluginOwnedSettingsUpdate\(body\)/);
  assert.doesNotMatch(
    route,
    /tx\.projectLanguage\.(?:create|createMany|update|updateMany|delete|deleteMany)\(/,
  );
  assert.doesNotMatch(route, /tx\.project\.update\(/);
  assert.doesNotMatch(route, /withBoundedMediaRuntimeMutation\(/);
});

test("plugin settings sync still validates domain mappings against authoritative active languages", () => {
  assert.match(
    route,
    /validatePluginDomainMappings\(\s*body,\s*activeTargetLanguages/,
  );
  assert.match(route, /kind:\s*"invalid_domain_mappings"/);
  assert.match(route, /code:\s*"domain_mapping_conflict"/);
});
