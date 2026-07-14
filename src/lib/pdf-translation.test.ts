import assert from "node:assert/strict";
import test from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  PdfTranslationError,
  parsePdfText,
  renderTranslatedPdf,
  validatePdfUpload,
} from "@/lib/pdf-translation";

async function createTextPdf(pages: string[]) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (const text of pages) {
    const page = document.addPage([595, 842]);
    if (text) {
      page.drawText(text, { x: 48, y: 780, size: 12, font });
    }
  }

  return document.save();
}

function rejectsWithCode(code: string) {
  return (error: unknown) =>
    error instanceof PdfTranslationError && error.code === code;
}

test("validates PDF type and size before parsing", () => {
  assert.throws(
    () =>
      validatePdfUpload({
        name: "document.txt",
        type: "text/plain",
        size: 10,
      }),
    rejectsWithCode("invalid_pdf_type")
  );
  assert.throws(
    () =>
      validatePdfUpload({
        name: "document.pdf",
        type: "application/pdf",
        size: MAX_PDF_BYTES + 1,
      }),
    rejectsWithCode("pdf_too_large")
  );
});

test("extracts text page by page from a valid text PDF", async () => {
  const parsed = await parsePdfText(
    await createTextPdf(["Erste Seite mit Text.", "Zweite Seite mit Text."])
  );

  assert.equal(parsed.totalPages, 2);
  assert.match(parsed.pages[0], /Erste Seite/);
  assert.match(parsed.pages[1], /Zweite Seite/);
  assert.equal(parsed.wordCount, 8);
});

test("rejects PDFs above the page limit before text extraction", async () => {
  const pages = Array.from({ length: MAX_PDF_PAGES + 1 }, (_, index) =>
    `Seite ${index + 1}`
  );

  await assert.rejects(
    async () => parsePdfText(await createTextPdf(pages)),
    rejectsWithCode("pdf_too_many_pages")
  );
});

test("rejects encrypted and scanned PDFs with actionable codes", async () => {
  const encryptedMarker = new TextEncoder().encode(
    "%PDF-1.7\n1 0 obj << /Encrypt 2 0 R >>\n%%EOF"
  );
  await assert.rejects(
    () => parsePdfText(encryptedMarker),
    rejectsWithCode("pdf_encrypted")
  );

  await assert.rejects(
    async () => parsePdfText(await createTextPdf([""])),
    rejectsWithCode("pdf_scanned_or_empty")
  );
});

test("renders translated pages as a downloadable text PDF", async () => {
  const output = await renderTranslatedPdf({
    pages: ["Translated first page.", "Translated second page."],
    sourceFilename: "source.pdf",
    langFrom: "de",
    langTo: "en",
  });
  const parsed = await parsePdfText(output);

  assert.equal(parsed.totalPages, 2);
  assert.match(parsed.pages[0], /Translated first page/);
  assert.match(parsed.pages[1], /Translated second page/);
  assert.match(parsed.pages[0], /Deepglot PDF translation/);
});

test("rejects output characters unsupported by the bounded PDF font", async () => {
  await assert.rejects(
    () =>
      renderTranslatedPdf({
        pages: ["Преведен текст"],
        sourceFilename: "source.pdf",
        langFrom: "de",
        langTo: "bg",
      }),
    rejectsWithCode("pdf_output_characters_unsupported")
  );
});
