import { NextRequest, NextResponse } from "next/server";

import { isSupportedTranslationPair } from "@/lib/supported-languages";
import { apiProblem, validationProblem } from "@/lib/problem-details";

export const runtime = "nodejs";

/**
 * GET /api/public/languages/is-supported?languageFrom=de&languageTo=en
 * Checks if a language pair is supported (canonical list in
 * src/lib/supported-languages.ts, shared with /api/public/languages).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const langFrom = searchParams.get("languageFrom");
    const langTo = searchParams.get("languageTo");

    if (!langFrom || !langTo) {
      return validationProblem({
        detail: "languageFrom and languageTo are required.",
        instance: "/api/public/languages/is-supported",
        errors: {
          ...(!langFrom ? { languageFrom: ["Required"] } : {}),
          ...(!langTo ? { languageTo: ["Required"] } : {}),
        },
      });
    }

    return NextResponse.json({
      is_supported: isSupportedTranslationPair(langFrom, langTo),
    });
  } catch (error) {
    console.error("[GET /api/public/languages/is-supported] Failed:", error);
    return apiProblem({
      status: 500,
      title: "Internal server error",
      detail: "Could not check language support.",
      code: "internal_error",
      instance: "/api/public/languages/is-supported",
    });
  }
}
