import type {
  TranslateTextsInput,
  TranslationResult,
} from "@/lib/translation-types";
import type { TranslationProviderConfig } from "@/lib/translation-config";

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

type GeminiPart = { text?: string };

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
};

type ParsedGeminiPayload = {
  translations: Array<{ text: string; detectedSourceLanguage?: string }>;
};

/**
 * Calls Google's Gemini `generateContent` endpoint with a translation prompt
 * and parses the strict-JSON response into `TranslationResult[]`.
 *
 * Quality/cost trade-off note: Google explicitly recommends
 * `gemini-3.1-flash-lite` (stable since March 2026) for high-volume
 * translation workloads — twice as fast as `gemini-2.5-flash-lite` while
 * also more accurate on translation, RAG and data extraction benchmarks.
 * Callers can override the model via project settings or
 * `GEMINI_TRANSLATION_MODEL`.
 */
export async function translateWithGemini(
  { texts, sourceLang, targetLang }: TranslateTextsInput,
  config: TranslationProviderConfig
): Promise<TranslationResult[]> {
  if (!config.apiKey) {
    throw new Error("Gemini API key is not configured.");
  }
  const model = config.model || "gemini-3.1-flash-lite";
  const baseUrl = (config.baseUrl || DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, "");
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

  const systemInstruction = [
    "You are a translation engine for website strings.",
    "Translate each input string independently.",
    "Preserve order, HTML tags, entities, placeholders, URLs, email addresses, product names, and template tokens.",
    'Return strict JSON shaped as {"translations":[{"text":"...","detectedSourceLanguage":"..."}]}.',
    "Do not add explanations or surrounding prose.",
  ].join(" ");

  const userPayload = JSON.stringify({ sourceLang, targetLang, texts });

  const body = {
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPayload }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`Gemini API error ${response.status}: ${detail}`);
  }

  const data = (await response.json().catch(() => null)) as GeminiResponse | null;
  if (!data) {
    throw new Error("Gemini API returned an unparseable JSON envelope.");
  }

  if (data.promptFeedback?.blockReason) {
    throw new Error(
      `Gemini blocked the translation prompt (${data.promptFeedback.blockReason}).`
    );
  }

  const rawText = collectCandidateText(data);
  if (!rawText) {
    throw new Error("Gemini API response did not include any model text output.");
  }

  let parsed: ParsedGeminiPayload;
  try {
    parsed = JSON.parse(rawText) as ParsedGeminiPayload;
  } catch {
    throw new Error("Gemini API response was not valid JSON.");
  }

  const translations = Array.isArray(parsed?.translations) ? parsed.translations : [];

  return texts.map((source, index) => {
    const entry = translations[index];
    if (entry && typeof entry.text === "string" && entry.text.length > 0) {
      const result: TranslationResult = { text: entry.text };
      if (typeof entry.detectedSourceLanguage === "string") {
        result.detectedSourceLanguage = entry.detectedSourceLanguage;
      }
      return result;
    }
    return { text: source };
  });
}

function collectCandidateText(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 400);
  } catch {
    return "(unable to read response body)";
  }
}
