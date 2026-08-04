import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActivityDigestSummary,
  getPreviousActivityDigestPeriod,
  hasActivityDigestActivity,
} from "@/lib/activity-digest";

test("uses the previous complete UTC Monday-to-Monday week", () => {
  const period = getPreviousActivityDigestPeriod(
    new Date("2026-08-03T08:00:00.000Z")
  );

  assert.equal(period.start.toISOString(), "2026-07-27T00:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-08-03T00:00:00.000Z");
});

test("keeps an incomplete current week out of manually triggered digests", () => {
  const period = getPreviousActivityDigestPeriod(
    new Date("2026-08-06T15:30:00.000Z")
  );

  assert.equal(period.start.toISOString(), "2026-07-27T00:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-08-03T00:00:00.000Z");
});

test("summarizes new translations, manual edits, and runtime requests per project", () => {
  const period = getPreviousActivityDigestPeriod(
    new Date("2026-08-03T08:00:00.000Z")
  );
  const summary = buildActivityDigestSummary({
    organizationName: "My workspace",
    period,
    projects: [
      { id: "project-a", name: "Juvenismed", domain: "juvenismed.at" },
      { id: "project-b", name: "Shop", domain: "shop.example" },
    ],
    translationGroups: [
      { projectId: "project-a", count: 2, wordCount: 12 },
      { projectId: "project-b", count: 1, wordCount: 3 },
    ],
    batchGroups: [
      {
        projectId: "project-a",
        provider: "openai",
        count: 11,
        manualWords: 4,
      },
      {
        projectId: "project-a",
        provider: "manual",
        count: 2,
        manualWords: 9,
      },
      {
        projectId: "project-a",
        provider: "import",
        count: 3,
        manualWords: 0,
      },
      {
        projectId: "project-b",
        provider: "deepl",
        count: 5,
        manualWords: 0,
      },
    ],
  });

  assert.deepEqual(summary.totals, {
    newTranslations: 3,
    newWords: 15,
    manualTranslations: 2,
    manualWords: 9,
    translationRequests: 16,
  });
  assert.deepEqual(summary.projects[0], {
    id: "project-a",
    name: "Juvenismed",
    domain: "juvenismed.at",
    newTranslations: 2,
    newWords: 12,
    manualTranslations: 2,
    manualWords: 9,
    translationRequests: 11,
  });
  assert.equal(hasActivityDigestActivity(summary), true);
});

test("recognizes an empty week so it does not generate noise", () => {
  const period = getPreviousActivityDigestPeriod(
    new Date("2026-08-03T08:00:00.000Z")
  );
  const summary = buildActivityDigestSummary({
    organizationName: "Quiet workspace",
    period,
    projects: [
      { id: "project-a", name: "Quiet", domain: "quiet.example" },
    ],
    translationGroups: [],
    batchGroups: [],
  });

  assert.equal(hasActivityDigestActivity(summary), false);
  assert.equal(summary.projects.length, 0);
});
