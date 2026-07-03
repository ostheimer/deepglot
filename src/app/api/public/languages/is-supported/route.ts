import { NextRequest, NextResponse } from "next/server";

import { isSupportedTranslationPair } from "@/lib/supported-languages";

export const runtime = "nodejs";

/**
 * GET /api/public/languages/is-supported?languageFrom=de&languageTo=en
 * Checks if a language pair is supported (canonical list in
 * src/lib/supported-languages.ts, shared with /api/public/languages).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const langFrom = searchParams.get("languageFrom");
  const langTo = searchParams.get("languageTo");

  if (!langFrom || !langTo) {
    return NextResponse.json(
      { error: "languageFrom and languageTo are required" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    is_supported: isSupportedTranslationPair(langFrom, langTo),
  });
}
