import assert from "node:assert/strict";
import { after, test } from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";

import { resolveDatabaseUrl } from "@/lib/database-url";
import {
  PdfTranslationError,
  parsePdfText,
  translateProjectPdf,
} from "@/lib/pdf-translation";
import {
  hashRateLimitSubject,
  TRANSLATE_WORD_VELOCITY_SCOPE,
} from "@/lib/rate-limit";
import { getUsageMonthKey } from "@/lib/translation-batches";

const databaseUrl = resolveDatabaseUrl();
const skipWithoutDatabase = databaseUrl
  ? false
  : "requires a prepared PostgreSQL database via DATABASE_URL or DEEPGLOT_DATABASE_URL";

async function createPdfFile() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([595, 842]);
  page.drawText("Hallo Welt aus PDF.", { x: 48, y: 780, size: 12, font });
  const bytes = await document.save();
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  return new File([arrayBuffer], "isolated-source.pdf", {
    type: "application/pdf",
  });
}

function rejectsWith(code: string, status: number) {
  return (error: unknown) =>
    error instanceof PdfTranslationError &&
    error.code === code &&
    error.status === status;
}

test(
  "PDF translation enforces tenant, language, quota and provider boundaries and records every successful provider spend",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const runId = crypto.randomUUID();
    const owner = await db.user.create({
      data: { email: `pdf-owner-${runId}@example.invalid` },
    });
    const outsider = await db.user.create({
      data: { email: `pdf-outsider-${runId}@example.invalid` },
    });
    const translator = await db.user.create({
      data: { email: `pdf-translator-${runId}@example.invalid` },
    });
    const organization = await db.organization.create({
      data: {
        name: `PDF acceptance ${runId}`,
        slug: `pdf-acceptance-${runId}`,
        members: {
          create: { userId: owner.id, role: "OWNER" },
        },
        subscription: {
          create: {
            stripeCustomerId: `cus_pdf_${runId}`,
            status: "ACTIVE",
            plan: "STARTER",
            wordsLimit: 100,
          },
        },
      },
    });
    const project = await db.project.create({
      data: {
        name: "PDF acceptance project",
        domain: `pdf-${runId}.invalid`,
        originalLang: "de",
        organizationId: organization.id,
        languages: {
          create: [
            { langCode: "en", isActive: true },
            { langCode: "fr", isActive: true },
          ],
        },
        settings: {
          create: { translationProvider: "mock" },
        },
        members: {
          create: {
            userId: translator.id,
            email: translator.email,
            role: "TRANSLATOR",
            langCode: "fr",
          },
        },
      },
    });
    const file = await createPdfFile();
    const currentMonth = getUsageMonthKey();

    try {
      await assert.rejects(
        () =>
          translateProjectPdf({
            userId: outsider.id,
            projectId: project.id,
            langTo: "en",
            file,
          }),
        rejectsWith("project_not_found", 404)
      );
      await assert.rejects(
        () =>
          translateProjectPdf({
            userId: translator.id,
            projectId: project.id,
            langTo: "en",
            file,
          }),
        rejectsWith("language_forbidden", 403)
      );
      await assert.rejects(
        () =>
          translateProjectPdf({
            userId: owner.id,
            projectId: project.id,
            langTo: "es",
            file,
          }),
        rejectsWith("language_not_active", 400)
      );

      const result = await translateProjectPdf({
        userId: owner.id,
        projectId: project.id,
        langTo: "en",
        file,
      });
      const output = await parsePdfText(result.bytes);

      assert.equal(result.pageCount, 1);
      assert.equal(result.wordCount, 4);
      assert.match(result.filename, /isolated-source-deepglot-en\.pdf$/);
      assert.match(output.pages[0], /\[en\] Hallo Welt aus PDF/);

      const usage = await db.usageRecord.findUnique({
        where: {
          organizationId_projectId_month: {
            organizationId: organization.id,
            projectId: project.id,
            month: currentMonth,
          },
        },
      });
      assert.equal(usage?.words, 4);
      const batch = await db.translationBatchLog.findFirst({
        where: { projectId: project.id },
        orderBy: { createdAt: "desc" },
      });
      assert.equal(batch?.provider, "mock");
      assert.equal(batch?.translatedWords, 4);

      await db.usageRecord.update({
        where: { id: usage!.id },
        data: { words: 99 },
      });
      let providerCalls = 0;
      await assert.rejects(
        () =>
          translateProjectPdf(
            {
              userId: owner.id,
              projectId: project.id,
              langTo: "en",
              file,
            },
            {
              translateTexts: async () => {
                providerCalls += 1;
                return [{ text: "must not run" }];
              },
            }
          ),
        rejectsWith("quota_exhausted", 402)
      );
      assert.equal(providerCalls, 0);

      await db.usageRecord.update({
        where: { id: usage!.id },
        data: { words: 0 },
      });
      await db.rateLimitBucket.deleteMany({
        where: {
          scope: TRANSLATE_WORD_VELOCITY_SCOPE,
          subjectHash: hashRateLimitSubject(
            TRANSLATE_WORD_VELOCITY_SCOPE,
            organization.id
          ),
        },
      });
      await assert.rejects(
        () =>
          translateProjectPdf(
            {
              userId: owner.id,
              projectId: project.id,
              langTo: "en",
              file,
            },
            {
              translateTexts: async () => {
                throw new Error("provider unavailable");
              },
            }
          ),
        rejectsWith("provider_failed", 502)
      );

      const usageAfterProviderFailure = await db.usageRecord.findUnique({
        where: { id: usage!.id },
      });
      const velocityAfterProviderFailure = await db.rateLimitBucket.findUnique({
        where: {
          scope_subjectHash: {
            scope: TRANSLATE_WORD_VELOCITY_SCOPE,
            subjectHash: hashRateLimitSubject(
              TRANSLATE_WORD_VELOCITY_SCOPE,
              organization.id
            ),
          },
        },
      });
      assert.equal(usageAfterProviderFailure?.words, 0);
      assert.equal(velocityAfterProviderFailure?.count, 0);

      await db.rateLimitBucket.deleteMany({
        where: {
          scope: TRANSLATE_WORD_VELOCITY_SCOPE,
          subjectHash: hashRateLimitSubject(
            TRANSLATE_WORD_VELOCITY_SCOPE,
            organization.id
          ),
        },
      });
      let unsupportedOutputProviderCalls = 0;
      await assert.rejects(
        () =>
          translateProjectPdf(
            {
              userId: owner.id,
              projectId: project.id,
              langTo: "en",
              file,
            },
            {
              translateTexts: async () => {
                unsupportedOutputProviderCalls += 1;
                return [{ text: "Преведен текст" }];
              },
            }
          ),
        rejectsWith("pdf_output_characters_unsupported", 422)
      );

      const usageAfterUnsupportedOutput = await db.usageRecord.findUnique({
        where: { id: usage!.id },
      });
      const velocityAfterUnsupportedOutput = await db.rateLimitBucket.findUnique({
        where: {
          scope_subjectHash: {
            scope: TRANSLATE_WORD_VELOCITY_SCOPE,
            subjectHash: hashRateLimitSubject(
              TRANSLATE_WORD_VELOCITY_SCOPE,
              organization.id
            ),
          },
        },
      });
      const unsupportedOutputBatch = await db.translationBatchLog.findFirst({
        where: { projectId: project.id },
        orderBy: { createdAt: "desc" },
      });
      assert.equal(unsupportedOutputProviderCalls, 1);
      assert.equal(usageAfterUnsupportedOutput?.words, 4);
      assert.equal(velocityAfterUnsupportedOutput?.count, 4);
      assert.equal(unsupportedOutputBatch?.translatedWords, 4);
    } finally {
      await db.rateLimitBucket.deleteMany({
        where: {
          scope: TRANSLATE_WORD_VELOCITY_SCOPE,
          subjectHash: hashRateLimitSubject(
            TRANSLATE_WORD_VELOCITY_SCOPE,
            organization.id
          ),
        },
      });
      await db.organization.delete({ where: { id: organization.id } });
      await db.user.deleteMany({
        where: { id: { in: [owner.id, outsider.id, translator.id] } },
      });
    }
  }
);

after(async () => {
  if (databaseUrl) {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
  }
});
