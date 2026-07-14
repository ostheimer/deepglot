import { NextRequest, NextResponse } from "next/server";

import {
  SUPPORTED_TRANSLATION_LANGUAGES,
  isSupportedTranslationPair,
} from "@/lib/supported-languages";
import { apiProblem } from "@/lib/problem-details";

export const runtime = "nodejs";

/**
 * GET /api/public/languages
 * Returns all supported languages (canonical list in
 * src/lib/supported-languages.ts, shared with /is-supported).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const langFrom = searchParams.get("languageFrom");
    const langTo = searchParams.get("languageTo");

    // /api/public/languages/is-supported via query params (legacy shim) —
    // same semantics as the dedicated endpoint, including the same-language
    // pair rejection.
    if (langFrom && langTo) {
      return NextResponse.json({
        is_supported: isSupportedTranslationPair(langFrom, langTo),
      });
    }

    return NextResponse.json(SUPPORTED_TRANSLATION_LANGUAGES);
  } catch (error) {
    console.error("[GET /api/public/languages] Failed:", error);
    return apiProblem({
      status: 500,
      title: "Internal server error",
      detail: "Could not load supported languages.",
      code: "internal_error",
      instance: "/api/public/languages",
    });
  }
}
