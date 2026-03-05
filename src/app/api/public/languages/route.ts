import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// All supported languages (ISO 639-1, subset via DeepL)
const LANGUAGES = [
  { code: "ar", local_name: "العربية‏", english_name: "Arabic" },
  { code: "bg", local_name: "български", english_name: "Bulgarian" },
  { code: "cs", local_name: "čeština", english_name: "Czech" },
  { code: "da", local_name: "dansk", english_name: "Danish" },
  { code: "de", local_name: "Deutsch", english_name: "German" },
  { code: "el", local_name: "ελληνικά", english_name: "Greek" },
  { code: "en", local_name: "English", english_name: "English" },
  { code: "es", local_name: "español", english_name: "Spanish" },
  { code: "et", local_name: "eesti", english_name: "Estonian" },
  { code: "fi", local_name: "suomi", english_name: "Finnish" },
  { code: "fr", local_name: "français", english_name: "French" },
  { code: "hu", local_name: "magyar", english_name: "Hungarian" },
  { code: "id", local_name: "Bahasa Indonesia", english_name: "Indonesian" },
  { code: "it", local_name: "italiano", english_name: "Italian" },
  { code: "ja", local_name: "日本語", english_name: "Japanese" },
  { code: "ko", local_name: "한국어", english_name: "Korean" },
  { code: "lt", local_name: "lietuvių", english_name: "Lithuanian" },
  { code: "lv", local_name: "latviešu", english_name: "Latvian" },
  { code: "nb", local_name: "norsk", english_name: "Norwegian" },
  { code: "nl", local_name: "Nederlands", english_name: "Dutch" },
  { code: "pl", local_name: "polski", english_name: "Polish" },
  { code: "pt", local_name: "português", english_name: "Portuguese" },
  { code: "ro", local_name: "română", english_name: "Romanian" },
  { code: "ru", local_name: "русский", english_name: "Russian" },
  { code: "sk", local_name: "slovenčina", english_name: "Slovak" },
  { code: "sl", local_name: "slovenščina", english_name: "Slovenian" },
  { code: "sv", local_name: "svenska", english_name: "Swedish" },
  { code: "tr", local_name: "Türkçe", english_name: "Turkish" },
  { code: "uk", local_name: "українська", english_name: "Ukrainian" },
  { code: "zh", local_name: "中文", english_name: "Chinese" },
];

/**
 * GET /api/public/languages
 * Returns all supported languages.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const langFrom = searchParams.get("languageFrom");
  const langTo = searchParams.get("languageTo");

  // /api/public/languages/is-supported via query params
  if (langFrom && langTo) {
    const fromSupported = LANGUAGES.some((l) => l.code === langFrom.toLowerCase());
    const toSupported = LANGUAGES.some((l) => l.code === langTo.toLowerCase());
    return NextResponse.json({ is_supported: fromSupported && toSupported });
  }

  return NextResponse.json(LANGUAGES);
}
