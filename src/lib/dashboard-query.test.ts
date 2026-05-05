import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAnalyticsHref,
  buildProjectQueryHref,
  normalizeAnalyticsParams,
  normalizeProjectLang,
} from "@/lib/dashboard-query";

test("normalizes project language query values to active project languages", () => {
  assert.equal(normalizeProjectLang("EN", ["de", "en"]), "en");
  assert.equal(normalizeProjectLang("xx", ["de", "en"]), "de");
  assert.equal(normalizeProjectLang(undefined, []), "en");
});

test("builds encoded project query hrefs", () => {
  assert.equal(
    buildProjectQueryHref({ lang: "en", page: 2, q: "a&b=c" }),
    "?lang=en&seite=2&q=a%26b%3Dc"
  );
  assert.equal(buildProjectQueryHref({ lang: "fr", page: 1 }), "?lang=fr");
});

test("normalizes analytics controls and hrefs", () => {
  assert.deepEqual(normalizeAnalyticsParams({ ansicht: "week", zeitraum: "90" }), {
    granularity: "week",
    range: "90",
  });
  assert.deepEqual(normalizeAnalyticsParams({ ansicht: "year", zeitraum: "365" }), {
    granularity: "day",
    range: "30",
  });
  assert.equal(
    buildAnalyticsHref({ granularity: "month", range: "7" }),
    "?zeitraum=7&ansicht=month"
  );
});
