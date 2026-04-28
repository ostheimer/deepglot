import type {
  TranslateTextsInput,
  TranslationProviderName,
  TranslationResult,
} from "@/lib/translation-types";
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_TRANSLATION_MODEL,
  type TranslationProviderConfig,
  validateTranslationProviderConfig,
} from "@/lib/translation-config";

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }>;
    };
  }>;
};

function getChatCompletionsUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions")
    ? trimmed
    : `${trimmed}/chat/completions`;
}

function shouldOmitTemperature(model: string) {
  const lower = model.toLowerCase();
  return lower.startsWith("gpt-5") || lower.startsWith("o1") || lower.startsWith("o3");
}

function getProviderErrorLabel(provider: TranslationProviderName) {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
    case "ollama":
      return "Ollama";
    case "openai-compatible":
      return "OpenAI-compatible provider";
    case "deepl":
      return "DeepL";
    case "mock":
      return "Mock provider";
  }
}

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

export async function translateWithOpenAICompatible(
  { texts, sourceLang, targetLang }: TranslateTextsInput,
  config: TranslationProviderConfig
): Promise<TranslationResult[]> {
  validateTranslationProviderConfig(config);
  const model = config.model || DEFAULT_OPENAI_TRANSLATION_MODEL;
  const baseUrl = config.baseUrl || DEFAULT_OPENAI_BASE_URL;

  const body = {
    model,
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
    ...(!shouldOmitTemperature(model) && { temperature: 0 }),
  };

  const response = await fetch(getChatCompletionsUrl(baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `${getProviderErrorLabel(config.provider)} API error ${response.status}: ${error}`
    );
  }

  const data = (await response.json()) as OpenAIChatCompletionResponse;
  const rawContent = getOpenAIMessageText(data.choices?.[0]?.message?.content);

  return parseOpenAITranslations(rawContent, texts.length);
}

export function translateWithOpenAI(
  input: TranslateTextsInput,
  env: Record<string, string | undefined> = process.env
) {
  return translateWithOpenAICompatible(input, {
    provider: "openai",
    model: env.OPENAI_TRANSLATION_MODEL || DEFAULT_OPENAI_TRANSLATION_MODEL,
    baseUrl: env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL,
    apiKey: env.OPENAI_API_KEY,
  });
}
