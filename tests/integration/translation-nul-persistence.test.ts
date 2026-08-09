import assert from "node:assert/strict";
import { after, test } from "node:test";

import { NextRequest } from "next/server";

import { generateApiKey } from "@/lib/api-keys";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { createEditorSessionToken } from "@/lib/editor-session";
import {
  hashRateLimitSubject,
  TRANSLATE_RATE_LIMIT_SCOPE,
} from "@/lib/rate-limit";

const databaseUrl = resolveDatabaseUrl();
const skipWithoutDatabase = databaseUrl
  ? false
  : "requires a prepared PostgreSQL database via DATABASE_URL or DEEPGLOT_DATABASE_URL";
const cleanupOrganizationIds = new Set<string>();
const cleanupRateLimitSubjects = new Set<string>();

test(
  "POST /api/translate rejects NUL source text before PostgreSQL persistence",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: {
        name: `NUL persistence ${suffix}`,
        slug: `nul-persistence-${suffix}`,
      },
    });
    cleanupOrganizationIds.add(organization.id);

    const project = await db.project.create({
      data: {
        name: "NUL persistence project",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        organizationId: organization.id,
        languages: { create: [{ langCode: "en" }] },
        settings: { create: { translationProvider: "mock" } },
      },
    });
    const { rawKey, apiKey } = await generateApiKey({
      projectId: project.id,
      name: "NUL persistence test",
    });
    cleanupRateLimitSubjects.add(
      hashRateLimitSubject(TRANSLATE_RATE_LIMIT_SCOPE, apiKey.id),
    );

    const { POST } = await import("@/app/api/translate/route");
    const response = await POST(
      new NextRequest("https://deepglot.test/api/translate", {
        method: "POST",
        headers: {
          authorization: `Bearer ${rawKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          l_from: "de",
          l_to: "en",
          words: [{ w: "Hallo\u0000Welt", t: 1 }],
          request_url: "https://example.test/en/nul-regression/",
        }),
      }),
    );
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "validation_failed");
    assert.ok(Array.isArray(body.errors?.["words.0.w"]));
    assert.equal(
      await db.translation.count({ where: { projectId: project.id } }),
      0,
    );
    assert.equal(
      await db.translationBatchLog.count({ where: { projectId: project.id } }),
      0,
    );
    assert.equal(
      await db.usageRecord.count({ where: { projectId: project.id } }),
      0,
    );

    const titleResponse = await POST(
      new NextRequest("https://deepglot.test/api/translate", {
        method: "POST",
        headers: {
          authorization: `Bearer ${rawKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          l_from: "de",
          l_to: "en",
          words: [{ w: "Sicherer Text", t: 1 }],
          request_url: "https://example.test/en/nul-title-regression/",
          title: "Unsicherer\u0000Titel",
        }),
      }),
    );
    const titleBody = await titleResponse.json();

    assert.equal(titleResponse.status, 400);
    assert.equal(titleBody.code, "validation_failed");
    assert.ok(Array.isArray(titleBody.errors?.title));
    assert.equal(
      await db.translation.count({ where: { projectId: project.id } }),
      0,
    );
    assert.equal(
      await db.translationBatchLog.count({ where: { projectId: project.id } }),
      0,
    );
    assert.equal(
      await db.usageRecord.count({ where: { projectId: project.id } }),
      0,
    );

    const previousEditorSecret = process.env.DEEPGLOT_EDITOR_SECRET;
    process.env.DEEPGLOT_EDITOR_SECRET = `nul-persistence-${suffix}`;
    try {
      const token = createEditorSessionToken({
        projectId: project.id,
        domain: project.domain,
        langTo: "en",
      });
      const { POST: saveManualTranslation } = await import(
        "@/app/api/projects/[projektId]/manual-translations/route"
      );
      const manualResponse = await saveManualTranslation(
        new NextRequest(
          `https://deepglot.test/api/projects/${project.id}/manual-translations`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: `https://${project.domain}`,
            },
            body: JSON.stringify({
              token,
              originalText: "Ein sicherer Ausgangstext",
              translatedText: "Unsafe\u0000translation",
              langFrom: "de",
              langTo: "en",
              requestUrl: `https://${project.domain}/en/manual/`,
            }),
          },
        ),
        { params: Promise.resolve({ projektId: project.id }) },
      );
      const manualBody = await manualResponse.json();

      assert.equal(manualResponse.status, 400);
      assert.equal(manualBody.code, "validation_failed");
      assert.ok(Array.isArray(manualBody.errors?.translatedText));
      assert.equal(
        await db.translation.count({ where: { projectId: project.id } }),
        0,
      );
    } finally {
      if (previousEditorSecret === undefined) {
        delete process.env.DEEPGLOT_EDITOR_SECRET;
      } else {
        process.env.DEEPGLOT_EDITOR_SECRET = previousEditorSecret;
      }
    }
  },
);

after(async () => {
  if (!databaseUrl) return;

  const { db } = await import("@/lib/db");
  if (cleanupOrganizationIds.size > 0) {
    await db.organization.deleteMany({
      where: { id: { in: [...cleanupOrganizationIds] } },
    });
  }
  if (cleanupRateLimitSubjects.size > 0) {
    await db.rateLimitBucket.deleteMany({
      where: {
        scope: TRANSLATE_RATE_LIMIT_SCOPE,
        subjectHash: { in: [...cleanupRateLimitSubjects] },
      },
    });
  }
  await db.$disconnect();
});
