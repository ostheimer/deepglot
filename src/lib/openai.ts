import type {
  TranslateTextsInput,
  TranslationEnv,
  TranslationResult,
} from "@/lib/translation-types";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_TRANSLATION_MODEL = "gpt-4o-mini";

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }>;
    };
  }>;
};

type OpenAITranslationPayload = {
  translations?: Array<
    | string
    | {
        detectedSourceLanguage?: string;
        text?: string;
      }
  >;
};

function getOpenAIMessageText(
  content: string | Array<{ text?: string; type?: string }> | undefined
): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();

    if (text) {
      return text;
    }
  }

  throw new Error("OpenAI hat keine nutzbare Antwort geliefert.");
}

function parseOpenAITranslations(
  rawContent: string,
  expectedCount: number
): TranslationResult[] {
  let payload: OpenAITranslationPayload;

  try {
    payload = JSON.parse(rawContent) as OpenAITranslationPayload;
  } catch {
    throw new Error("OpenAI hat kein gueltiges JSON fuer die Uebersetzung geliefert.");
  }

  if (!Array.isArray(payload.translations)) {
    throw new Error("OpenAI-Antwort enthaelt kein 'translations'-Array.");
  }

  if (payload.translations.length !== expectedCount) {
    throw new Error(
      `OpenAI hat ${payload.translations.length} statt ${expectedCount} Uebersetzungen geliefert.`
    );
  }

  return payload.translations.map((item, index) => {
    if (typeof item === "string") {
      return { text: item };
    }

    if (!item || typeof item.text !== "string") {
      throw new Error(
        `OpenAI hat fuer Eintrag ${index + 1} keine gueltige Uebersetzung geliefert.`
      );
    }

    return {
      detectedSourceLanguage:
        typeof item.detectedSourceLanguage === "string"
          ? item.detectedSourceLanguage
          : undefined,
      text: item.text,
    };
  });
}

export async function translateWithOpenAI(
  { texts, sourceLang, targetLang }: TranslateTextsInput,
  env: TranslationEnv = process.env
): Promise<TranslationResult[]> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY ist nicht konfiguriert.");
  }

  const model = env.OPENAI_TRANSLATION_MODEL || DEFAULT_OPENAI_TRANSLATION_MODEL;

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a translation engine for website strings. Translate each input string independently. Preserve order, HTML tags, entities, placeholders, URLs, email addresses, product names, and template tokens. Return strict JSON with the shape {\"translations\":[{\"text\":\"...\",\"detectedSourceLanguage\":\"...\"}]}. Do not add explanations.",
        },
        {
          role: "user",
          content: JSON.stringify({
            sourceLang,
            targetLang,
            texts,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API Fehler ${response.status}: ${error}`);
  }

  const data = (await response.json()) as OpenAIChatCompletionResponse;
  const rawContent = getOpenAIMessageText(data.choices?.[0]?.message?.content);

  return parseOpenAITranslations(rawContent, texts.length);
}
