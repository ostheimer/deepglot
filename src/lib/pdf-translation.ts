import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";

import { getEffectiveWordsLimit } from "@/lib/billing-plans";
import { sanitizeFilenamePart } from "@/lib/import-export";
import {
  canAccessProject,
  canAccessProjectLanguage,
  getProjectAccess,
} from "@/lib/project-access";
import {
  consumeTranslateWordVelocity,
  getTranslateWordVelocityLimit,
  releaseTranslateWordVelocity,
} from "@/lib/rate-limit";
import { shouldRejectTranslateRequest } from "@/lib/translate-quota";
import {
  countWords,
  resolveTranslationProvider,
  translateTexts,
} from "@/lib/translation";

export const MAX_PDF_BYTES = 4 * 1024 * 1024;
export const MAX_PDF_PAGES = 20;
export const MAX_PDF_WORDS = 10_000;

const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;
const PDF_MARGIN = 48;
const PDF_BODY_FONT_SIZE = 11;
const PDF_LINE_HEIGHT = 15;

export class PdfTranslationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "PdfTranslationError";
  }
}

export type PdfUpload = {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type ParsedPdfText = {
  totalPages: number;
  pages: string[];
  wordCount: number;
};

export type TranslateProjectPdfInput = {
  userId: string;
  projectId: string;
  langTo: string;
  file: PdfUpload;
};

type PdfTranslationDependencies = {
  translateTexts?: typeof translateTexts;
};

export function validatePdfUpload(file: Pick<PdfUpload, "name" | "type" | "size">) {
  const hasPdfExtension = file.name.toLowerCase().endsWith(".pdf");
  const hasPdfType = file.type === "application/pdf" || file.type === "";

  if (!hasPdfExtension || !hasPdfType || file.size <= 0) {
    throw new PdfTranslationError(
      "Choose a non-empty PDF file.",
      "invalid_pdf_type",
      400
    );
  }

  if (file.size > MAX_PDF_BYTES) {
    throw new PdfTranslationError(
      `The PDF exceeds the ${MAX_PDF_BYTES / 1024 / 1024} MiB upload limit.`,
      "pdf_too_large",
      413
    );
  }
}

function hasPdfHeader(bytes: Uint8Array) {
  const prefix = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024)));
  return prefix.includes(Buffer.from("%PDF-", "ascii"));
}

function hasEncryptionMarker(bytes: Uint8Array) {
  return Buffer.from(bytes).includes(Buffer.from("/Encrypt", "ascii"));
}

function normalizeExtractedPage(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parserError(error: unknown): PdfTranslationError {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);

  if (name === "PasswordException" || /password|encrypted/i.test(message)) {
    return new PdfTranslationError(
      "Password-protected or encrypted PDFs are not supported.",
      "pdf_encrypted",
      422
    );
  }

  return new PdfTranslationError(
    "The uploaded file could not be parsed as a PDF.",
    "invalid_pdf",
    422
  );
}

export async function parsePdfText(bytes: Uint8Array): Promise<ParsedPdfText> {
  if (!hasPdfHeader(bytes)) {
    throw new PdfTranslationError(
      "The uploaded file does not contain a valid PDF header.",
      "invalid_pdf",
      422
    );
  }

  if (hasEncryptionMarker(bytes)) {
    throw new PdfTranslationError(
      "Password-protected or encrypted PDFs are not supported.",
      "pdf_encrypted",
      422
    );
  }

  let document: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;

  try {
    document = await getDocumentProxy(bytes);

    if (document.numPages > MAX_PDF_PAGES) {
      throw new PdfTranslationError(
        `The PDF has ${document.numPages} pages; the current limit is ${MAX_PDF_PAGES}.`,
        "pdf_too_many_pages",
        413
      );
    }

    const extracted = await extractText(document, { mergePages: false });
    const pages = extracted.text.map(normalizeExtractedPage);

    if (pages.length === 0 || pages.some((page) => countWords(page) === 0)) {
      throw new PdfTranslationError(
        "Every page must contain extractable text. Scanned, image-only, and blank-page PDFs are not supported.",
        "pdf_scanned_or_empty",
        422
      );
    }

    const wordCount = pages.reduce((sum, page) => sum + countWords(page), 0);
    if (wordCount > MAX_PDF_WORDS) {
      throw new PdfTranslationError(
        `The PDF contains about ${wordCount} words; the current limit is ${MAX_PDF_WORDS}.`,
        "pdf_too_many_words",
        413
      );
    }

    return {
      totalPages: extracted.totalPages,
      pages,
      wordCount,
    };
  } catch (error) {
    if (error instanceof PdfTranslationError) {
      throw error;
    }
    throw parserError(error);
  } finally {
    await document?.destroy().catch(() => undefined);
  }
}

function assertFontSupports(font: PDFFont, text: string) {
  const supported = new Set(font.getCharacterSet());
  const unsupported = Array.from(text).find((character) => {
    if (/\s/.test(character)) return false;
    const codePoint = character.codePointAt(0);
    return codePoint === undefined || !supported.has(codePoint);
  });

  if (unsupported) {
    throw new PdfTranslationError(
      "The translated text contains characters unsupported by the current PDF output font.",
      "pdf_output_characters_unsupported",
      422
    );
  }
}

function splitLongWord(word: string, font: PDFFont, maxWidth: number) {
  const chunks: string[] = [];
  let chunk = "";

  for (const character of Array.from(word)) {
    const candidate = `${chunk}${character}`;
    if (
      chunk &&
      font.widthOfTextAtSize(candidate, PDF_BODY_FONT_SIZE) > maxWidth
    ) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }

  if (chunk) chunks.push(chunk);
  return chunks;
}

function wrapPdfText(text: string, font: PDFFont, maxWidth: number) {
  const lines: string[] = [];
  const paragraphs = text.split(/\n+/);

  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = "";

    for (const word of words) {
      const pieces =
        font.widthOfTextAtSize(word, PDF_BODY_FONT_SIZE) > maxWidth
          ? splitLongWord(word, font, maxWidth)
          : [word];

      for (const piece of pieces) {
        const candidate = line ? `${line} ${piece}` : piece;
        if (
          line &&
          font.widthOfTextAtSize(candidate, PDF_BODY_FONT_SIZE) > maxWidth
        ) {
          lines.push(line);
          line = piece;
        } else {
          line = candidate;
        }
      }
    }

    if (line) lines.push(line);
    lines.push("");
  }

  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export async function renderTranslatedPdf({
  pages,
  sourceFilename,
  langFrom,
  langTo,
}: {
  pages: string[];
  sourceFilename: string;
  langFrom: string;
  langTo: string;
}) {
  const document = await PDFDocument.create();
  const bodyFont = await document.embedFont(StandardFonts.Helvetica);
  const headingFont = await document.embedFont(StandardFonts.HelveticaBold);
  const maxWidth = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
  const maxLines = Math.floor(
    (PDF_PAGE_HEIGHT - PDF_MARGIN * 2 - 56) / PDF_LINE_HEIGHT
  );

  document.setTitle(`Deepglot PDF translation - ${sourceFilename}`);
  document.setSubject(`${langFrom.toUpperCase()} to ${langTo.toUpperCase()}`);
  document.setProducer("Deepglot");

  pages.forEach((translatedPage, sourcePageIndex) => {
    assertFontSupports(bodyFont, translatedPage);
    const lines = wrapPdfText(translatedPage, bodyFont, maxWidth);
    const chunks = Array.from(
      { length: Math.max(1, Math.ceil(lines.length / maxLines)) },
      (_, index) => lines.slice(index * maxLines, (index + 1) * maxLines)
    );

    chunks.forEach((chunk, chunkIndex) => {
      const page = document.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
      const heading = `Deepglot PDF translation - ${langFrom.toUpperCase()} to ${langTo.toUpperCase()}`;
      const pageLabel = `Source page ${sourcePageIndex + 1}/${pages.length}${
        chunks.length > 1 ? ` - part ${chunkIndex + 1}/${chunks.length}` : ""
      }`;

      page.drawText(heading, {
        x: PDF_MARGIN,
        y: PDF_PAGE_HEIGHT - PDF_MARGIN,
        size: 13,
        font: headingFont,
      });
      page.drawText(pageLabel, {
        x: PDF_MARGIN,
        y: PDF_PAGE_HEIGHT - PDF_MARGIN - 22,
        size: 9,
        font: bodyFont,
      });

      chunk.forEach((line, lineIndex) => {
        if (!line) return;
        page.drawText(line, {
          x: PDF_MARGIN,
          y: PDF_PAGE_HEIGHT - PDF_MARGIN - 56 - lineIndex * PDF_LINE_HEIGHT,
          size: PDF_BODY_FONT_SIZE,
          font: bodyFont,
        });
      });
    });
  });

  return document.save();
}

function buildOutputFilename(sourceFilename: string, langTo: string) {
  const sourceBase = sourceFilename.replace(/\.pdf$/i, "");
  const safeBase = sanitizeFilenamePart(sourceBase) || "translated-document";
  const safeLanguage = sanitizeFilenamePart(langTo.toLowerCase()) || "translated";
  return `${safeBase}-deepglot-${safeLanguage}.pdf`;
}

async function releaseVelocityReservation(organizationId: string, words: number) {
  try {
    await releaseTranslateWordVelocity({ organizationId, words });
  } catch (error) {
    console.error("[pdf-translation] Failed to release velocity reservation:", error);
  }
}

export async function translateProjectPdf(
  input: TranslateProjectPdfInput,
  dependencies: PdfTranslationDependencies = {}
) {
  const langTo = input.langTo.trim().toLowerCase();
  const access = await getProjectAccess(input.userId, input.projectId);

  if (!access || !canAccessProject(access)) {
    throw new PdfTranslationError(
      "Project not found.",
      "project_not_found",
      404
    );
  }

  if (!canAccessProjectLanguage(access, langTo)) {
    throw new PdfTranslationError(
      "You are not authorized to translate this language.",
      "language_forbidden",
      403
    );
  }

  const [
    { db },
    { getUsageMonthKey, incrementUsageRecord, recordTranslationBatch },
  ] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/translation-batches"),
  ]);
  const project = await db.project.findUnique({
    where: { id: input.projectId },
    include: {
      languages: { where: { isActive: true } },
      settings: true,
      organization: { include: { subscription: true } },
    },
  });

  if (!project) {
    throw new PdfTranslationError(
      "Project not found.",
      "project_not_found",
      404
    );
  }

  if (
    !langTo ||
    !project.languages.some(
      (language) => language.langCode.toLowerCase() === langTo
    )
  ) {
    throw new PdfTranslationError(
      "Choose an active target language for this project.",
      "language_not_active",
      400
    );
  }

  validatePdfUpload(input.file);
  const parsed = await parsePdfText(new Uint8Array(await input.file.arrayBuffer()));
  const currentMonth = getUsageMonthKey();
  const wordsLimit = getEffectiveWordsLimit(project.organization.subscription);
  const usage = await db.usageRecord.aggregate({
    where: {
      organizationId: project.organizationId,
      month: currentMonth,
    },
    _sum: { words: true },
  });
  const wordsUsed = usage._sum.words ?? 0;

  if (
    shouldRejectTranslateRequest({
      wordsUsed,
      wordsLimit,
      pendingWordCount: parsed.wordCount,
      quotaProbe: false,
    })
  ) {
    throw new PdfTranslationError(
      "The PDF would exceed the organization's monthly word quota.",
      "quota_exhausted",
      402
    );
  }

  const velocity = await consumeTranslateWordVelocity({
    organizationId: project.organizationId,
    words: parsed.wordCount,
    limit: getTranslateWordVelocityLimit(wordsLimit),
  });
  if (!velocity.allowed) {
    throw new PdfTranslationError(
      "The translation velocity limit is currently reached. Try again later.",
      "velocity_limited",
      429
    );
  }

  const translate = dependencies.translateTexts ?? translateTexts;
  const provider = resolveTranslationProvider(undefined, project.settings);
  let translatedPages: string[];

  try {
    const results = await translate(
      {
        texts: parsed.pages,
        sourceLang: project.originalLang,
        targetLang: langTo,
      },
      undefined,
      project.settings
    );

    if (
      results.length !== parsed.pages.length ||
      results.some((result) => !result.text.trim())
    ) {
      throw new Error("Provider returned incomplete PDF page translations.");
    }
    translatedPages = results.map((result) => result.text.trim());
  } catch (error) {
    await releaseVelocityReservation(project.organizationId, parsed.wordCount);
    console.error("[pdf-translation] Provider failed:", error);
    throw new PdfTranslationError(
      "The translation provider could not translate this PDF.",
      "provider_failed",
      502
    );
  }

  // The provider has completed at this point, so its word spend is real even
  // if PDF generation later rejects an unsupported glyph or otherwise fails.
  // Persist usage before rendering and keep the velocity reservation. Releasing
  // either here would make a deterministic output failure an unlimited retry
  // path against the configured provider.
  try {
    await db.$transaction(async (tx) => {
      await incrementUsageRecord({
        organizationId: project.organizationId,
        projectId: project.id,
        words: parsed.wordCount,
        month: currentMonth,
        tx,
      });
      await recordTranslationBatch(
        {
          organizationId: project.organizationId,
          projectId: project.id,
          langFrom: project.originalLang,
          langTo,
          provider,
          totalWords: parsed.wordCount,
          cachedWords: 0,
          manualWords: 0,
          glossaryWords: 0,
          translatedWords: parsed.wordCount,
        },
        tx
      );
    });
  } catch (error) {
    console.error("[pdf-translation] Usage persistence failed:", error);
    throw new PdfTranslationError(
      "The translated PDF could not be finalized.",
      "pdf_persistence_failed",
      500
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await renderTranslatedPdf({
      pages: translatedPages,
      sourceFilename: input.file.name,
      langFrom: project.originalLang,
      langTo,
    });
  } catch (error) {
    if (error instanceof PdfTranslationError) throw error;
    throw new PdfTranslationError(
      "The translated PDF output could not be generated.",
      "pdf_output_failed",
      500
    );
  }

  return {
    bytes,
    filename: buildOutputFilename(input.file.name, langTo),
    pageCount: parsed.totalPages,
    wordCount: parsed.wordCount,
  };
}
