import { translateWithDeepL } from "@/lib/deepl";
import { translateWithOpenAI } from "@/lib/openai";
import type {
  TranslateTextsInput,
  TranslationEnv,
  TranslationProviderName,
  TranslationResult,
} from "@/lib/translation-types";
export { countWords } from "@/lib/translation-types";

const VALID_TRANSLATION_PROVIDERS = new Set<TranslationProviderName>([
  "deepl",
  "mock",
  "openai",
]);

function translateWithMock({
  texts,
  sourceLang,
  targetLang,
}: TranslateTextsInput): TranslationResult[] {
  return texts.map((text) => {
    if (!text.trim() || sourceLang.toLowerCase() === targetLang.toLowerCase()) {
      return {
        detectedSourceLanguage: sourceLang.toUpperCase(),
        text,
      };
    }

    return {
      detectedSourceLanguage: sourceLang.toUpperCase(),
      text: `[${targetLang.toLowerCase()}] ${text}`,
    };
  });
}

export function resolveTranslationProvider(
  env: TranslationEnv = process.env
): TranslationProviderName {
  const configuredProvider = env.TRANSLATION_PROVIDER?.trim().toLowerCase();

  if (configuredProvider) {
    if (VALID_TRANSLATION_PROVIDERS.has(configuredProvider as TranslationProviderName)) {
      return configuredProvider as TranslationProviderName;
    }

    throw new Error(
      `Unbekannter TRANSLATION_PROVIDER '${configuredProvider}'. Erlaubt sind: openai, deepl, mock.`
    );
  }

  if (env.OPENAI_API_KEY) {
    return "openai";
  }

  if (env.DEEPL_API_KEY) {
    return "deepl";
  }

  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
    return "mock";
  }

  throw new Error(
    "Kein Uebersetzungs-Provider konfiguriert. Setze TRANSLATION_PROVIDER oder OPENAI_API_KEY / DEEPL_API_KEY."
  );
}

export async function translateTexts(
  input: TranslateTextsInput,
  env: TranslationEnv = process.env
): Promise<TranslationResult[]> {
  const provider = resolveTranslationProvider(env);

  switch (provider) {
    case "openai":
      return translateWithOpenAI(input, env);
    case "deepl":
      return translateWithDeepL(input, env);
    case "mock":
      return translateWithMock(input);
    default:
      throw new Error(`Provider '${provider}' wird nicht unterstuetzt.`);
  }
}
