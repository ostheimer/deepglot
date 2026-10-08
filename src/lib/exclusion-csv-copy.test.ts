import assert from "node:assert/strict";
import test from "node:test";

import { exclusionCsvText } from "@/lib/exclusion-csv-copy";

test("exclusion CSV copy uses German, English, and an explicit English fallback", () => {
  assert.equal(exclusionCsvText("de", "Preview import", "Importvorschau"), "Importvorschau");
  assert.equal(exclusionCsvText("en", "Preview import", "Importvorschau"), "Preview import");
  assert.equal(exclusionCsvText("fr", "Preview import", "Importvorschau"), "Preview import");
});
