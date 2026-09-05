import assert from "node:assert/strict";
import test from "node:test";

import { planTranslationPaginationAfterDeletion } from "@/lib/translation-workspace-pagination";

test("deleting the last item on a page clamps translation-workspace pagination", () => {
  assert.deepEqual(
    planTranslationPaginationAfterDeletion({
      total: 26,
      page: 2,
      pageSize: 25,
    }),
    { total: 25, totalPages: 1, page: 1 },
  );
  assert.deepEqual(
    planTranslationPaginationAfterDeletion({
      total: 26,
      page: 1,
      pageSize: 25,
    }),
    { total: 25, totalPages: 1, page: 1 },
  );
});
