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
import { PostgresTextBoundaryError } from "@/lib/postgres-text";

const databaseUrl = resolveDatabaseUrl();
const skipWithoutDatabase = databaseUrl
  ? false
  : "requires a prepared PostgreSQL database via DATABASE_URL or DEEPGLOT_DATABASE_URL";
const cleanupOrganizationIds = new Set<string>();
const cleanupRateLimitSubjects = new Set<string>();

test(
  "translation boundaries reject NUL before PostgreSQL text and JSON persistence",
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

      const originalWarn = console.warn;
      const manualWarnings: string[] = [];
      console.warn = (...args) => {
        manualWarnings.push(args.map((value) => String(value)).join(" "));
      };
      let manualLangResponse: Response;
      try {
        manualLangResponse = await saveManualTranslation(
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
                translatedText: "A safe translation",
                langFrom: "de",
                langTo: "e\u0000n",
                requestUrl: `https://${project.domain}/en/manual/`,
              }),
            },
          ),
          { params: Promise.resolve({ projektId: project.id }) },
        );
      } finally {
        console.warn = originalWarn;
      }
      const manualLangBody = await manualLangResponse.json();

      assert.equal(manualLangResponse.status, 400);
      assert.equal(manualLangBody.code, "validation_failed");
      assert.ok(Array.isArray(manualLangBody.errors?.langTo));
      assert.match(manualWarnings.join("\n"), /postgres_text_nul_rejected/);
      assert.match(manualWarnings.join("\n"), /manual_translation_input/);
      assert.match(manualWarnings.join("\n"), /langTo/);
      assert.doesNotMatch(
        manualWarnings.join("\n"),
        /Ein sicherer Ausgangstext|A safe translation|example\.test/,
      );
    } finally {
      if (previousEditorSecret === undefined) {
        delete process.env.DEEPGLOT_EDITOR_SECRET;
      } else {
        process.env.DEEPGLOT_EDITOR_SECRET = previousEditorSecret;
      }
    }

    const { importTranslationsCsv } = await import(
      "@/lib/project-translation-import"
    );
    await assert.rejects(
      importTranslationsCsv(
        [
          '"originalText","translatedText","langFrom","langTo","isManual","source"',
          '"Safe source","Unsafe\u0000translation","de","en","true","IMPORT"',
        ].join("\n"),
        {
          project,
          access: {
            organizationRole: "OWNER",
            projectRole: null,
            langCode: null,
          },
          locale: "en",
          emitRowEvents: false,
        },
      ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 400 &&
        "message" in error &&
        typeof error.message === "string" &&
        error.message.includes("U+0000"),
    );
    assert.equal(
      await db.translation.count({ where: { projectId: project.id } }),
      0,
    );

    const persistenceWarnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
      persistenceWarnings.push(args.map((value) => String(value)).join(" "));
    };

    const assertBoundary =
      (boundary: string, field: string) => (error: unknown) =>
        error instanceof PostgresTextBoundaryError &&
        error.event.boundary === boundary &&
        error.event.field === field;

    const privateProvider = "private-provider\u0000payload";
    const privateUrl = "https://private.example.test/en/unsafe\u0000url/";
    const privateWebhookText = "private-webhook\u0000payload";

    try {
      const {
        recordTranslationBatch,
        upsertTranslatedUrlHit,
      } = await import("@/lib/translation-batches");
      await assert.rejects(
        recordTranslationBatch({
          organizationId: organization.id,
          projectId: project.id,
          langFrom: "de",
          langTo: "en",
          provider: privateProvider,
          totalWords: 1,
          cachedWords: 0,
          manualWords: 0,
          glossaryWords: 0,
          translatedWords: 1,
        }),
        assertBoundary("translation_batch_persistence", "provider"),
      );
      await assert.rejects(
        upsertTranslatedUrlHit({
          projectId: project.id,
          langTo: "en",
          requestUrl: privateUrl,
          wordCount: 1,
        }),
        assertBoundary("translated_url_persistence", "requestUrl"),
      );

      const endpoint = await db.webhookEndpoint.create({
        data: {
          projectId: project.id,
          url: "https://hooks.example.test/deepglot",
          secret: "test-secret",
          eventTypes: ["translation.created"],
        },
      });
      const { queueProjectWebhookEvent } = await import(
        "@/lib/project-webhook-delivery"
      );
      await assert.rejects(
        queueProjectWebhookEvent({
          projectId: project.id,
          eventType: "translation.created",
          payload: {
            type: "translation.created",
            translatedText: privateWebhookText,
          },
        }),
        assertBoundary("webhook_event_persistence", "payload"),
      );
      assert.equal(
        await db.webhookDelivery.count({ where: { endpointId: endpoint.id } }),
        0,
      );
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(
      await db.translationBatchLog.count({ where: { projectId: project.id } }),
      0,
    );
    assert.equal(
      await db.translatedUrl.count({ where: { projectId: project.id } }),
      0,
    );
    const warnings = persistenceWarnings.join("\n");
    assert.match(warnings, /translation_batch_persistence/);
    assert.match(warnings, /translated_url_persistence/);
    assert.match(warnings, /webhook_event_persistence/);
    assert.doesNotMatch(
      warnings,
      /private-provider|private\.example\.test|private-webhook/,
    );
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
