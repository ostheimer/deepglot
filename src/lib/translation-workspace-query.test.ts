import assert from "node:assert/strict";
import { test } from "node:test";
import {
  workspaceSqlOrder,
  workspaceSqlWhere,
} from "./translation-workspace-query";

test("quality SQL materializes token counts once per text, not per variable", () => {
  const query = workspaceSqlWhere(
    "project",
    "en",
    { quality: "mismatch" },
    new Date(),
  );
  assert.equal(query.text.match(/regexp_matches/g)?.length, 2);
  assert.equal(query.text.match(/AS MATERIALIZED/g)?.length, 2);
});

test("workspace SQL binds user input and uses only fixed sorting expressions", () => {
  const hostile = "' OR TRUE --";
  const query = workspaceSqlWhere(
    hostile,
    "en",
    {
      query: hostile,
      label: hostile,
      assignedToId: hostile,
      urlPath: `/${hostile}`,
    },
    new Date(),
  );
  assert.ok(!query.text.includes(hostile));
  assert.ok(query.values.includes(hostile));
  assert.equal(
    workspaceSqlOrder(undefined).text,
    't."updatedAt" DESC, t.id ASC',
  );
});
