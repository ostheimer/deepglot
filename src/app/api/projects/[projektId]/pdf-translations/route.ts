import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedUserId } from "@/lib/project-access";
import {
  PDF_TRANSLATION_REQUEST_TIMEOUT_MS,
  PdfTranslationError,
  translateProjectPdf,
  type PdfTranslationDependencies,
  type PdfUpload,
  type TranslateProjectPdfInput,
} from "@/lib/pdf-translation";

export const runtime = "nodejs";
export const maxDuration = 60;

type PdfTranslationRouteDependencies = {
  getUserId: () => Promise<string | null>;
  translateProjectPdf: (
    input: TranslateProjectPdfInput,
    dependencies?: Pick<PdfTranslationDependencies, "providerBudgetSignal">
  ) => Promise<{
    bytes: Uint8Array;
    filename: string;
    pageCount: number;
    wordCount: number;
  }>;
};

function isPdfUpload(value: FormDataEntryValue | null): value is File & PdfUpload {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    "type" in value &&
    "size" in value &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function"
  );
}

export function createPdfTranslationPostHandler(
  dependencies: PdfTranslationRouteDependencies = {
    getUserId: getAuthenticatedUserId,
    translateProjectPdf: (input, routeDependencies) =>
      translateProjectPdf(input, routeDependencies),
  }
) {
  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ projektId: string }> }
  ) {
    const providerBudgetSignal = AbortSignal.timeout(
      PDF_TRANSLATION_REQUEST_TIMEOUT_MS
    );
    const userId = await dependencies.getUserId();
    if (!userId) {
      return NextResponse.json(
        { error: "Not authenticated.", code: "not_authenticated" },
        { status: 401 }
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Expected a multipart PDF upload.", code: "invalid_form_data" },
        { status: 400 }
      );
    }

    const file = formData.get("file");
    const rawLangTo = formData.get("langTo");
    const langTo = typeof rawLangTo === "string" ? rawLangTo.trim().toLowerCase() : "";

    if (!isPdfUpload(file) || !langTo) {
      return NextResponse.json(
        {
          error: "A PDF file and target language are required.",
          code: "invalid_pdf_request",
        },
        { status: 400 }
      );
    }

    const { projektId } = await params;

    try {
      const result = await dependencies.translateProjectPdf(
        {
          userId,
          projectId: projektId,
          langTo,
          file,
        },
        { providerBudgetSignal }
      );

      return new Response(Buffer.from(result.bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${result.filename}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Deepglot-Pdf-Pages": String(result.pageCount),
          "X-Deepglot-Pdf-Words": String(result.wordCount),
        },
      });
    } catch (error) {
      if (error instanceof PdfTranslationError) {
        const retryAfter =
          error.status === 429 &&
          error.retryAfterSeconds !== null &&
          Number.isFinite(error.retryAfterSeconds)
            ? Math.max(1, Math.floor(error.retryAfterSeconds))
            : null;
        return NextResponse.json(
          {
            error: error.message,
            code: error.code,
            ...(retryAfter === null ? {} : { retry_after: retryAfter }),
          },
          {
            status: error.status,
            ...(retryAfter === null
              ? {}
              : { headers: { "Retry-After": String(retryAfter) } }),
          },
        );
      }

      console.error("[pdf-translations] Unexpected failure:", error);
      return NextResponse.json(
        {
          error: "The PDF translation failed unexpectedly.",
          code: "pdf_translation_failed",
        },
        { status: 500 }
      );
    }
  };
}

export const POST = createPdfTranslationPostHandler();
