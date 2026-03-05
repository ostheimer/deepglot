import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const SUPPORTED_CODES = new Set([
  "ar","bg","cs","da","de","el","en","es","et","fi","fr","hu",
  "id","it","ja","ko","lt","lv","nb","nl","pl","pt","ro","ru",
  "sk","sl","sv","tr","uk","zh",
]);

/**
 * GET /api/public/languages/is-supported?languageFrom=de&languageTo=en
 * Checks if a language pair is supported.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const langFrom = searchParams.get("languageFrom")?.toLowerCase();
  const langTo = searchParams.get("languageTo")?.toLowerCase();

  if (!langFrom || !langTo) {
    return NextResponse.json(
      { error: "languageFrom and languageTo are required" },
      { status: 400 }
    );
  }

  const is_supported =
    SUPPORTED_CODES.has(langFrom) &&
    SUPPORTED_CODES.has(langTo) &&
    langFrom !== langTo;

  return NextResponse.json({ is_supported });
}
