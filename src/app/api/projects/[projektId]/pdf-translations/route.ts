import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedUserId } from "@/lib/project-access";
import {
  PdfTranslationError,
  translateProjectPdf,
  type PdfUpload,
  type TranslateProjectPdfInput,
} from "@/lib/pdf-translation";

export const runtime = "nodejs";
export const maxDuration = 60;

type PdfTranslationRouteDependencies = {
  getUserId: () => Promise<string | null>;
  translateProjectPdf: (
    input: TranslateProjectPdfInput
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
    translateProjectPdf,
  }
) {
  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ projektId: string }> }
  ) {
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
      const result = await dependencies.translateProjectPdf({
        userId,
        projectId: projektId,
        langTo,
        file,
      });

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
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.status }
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
