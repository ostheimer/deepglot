import test from "node:test";
import assert from "node:assert/strict";

import { encryptSecret } from "@/lib/secret-encryption";
import {
  DEFAULT_OPENAI_TRANSLATION_MODEL,
  normalizeTranslationProvider,
  resolveTranslationProviderConfig,
  serializeLanguageModelApiResponse,
  validateTranslationProviderConfig,
} from "@/lib/translation-config";

const secretEnv = { AUTH_SECRET: "translation-config-test-secret" };

test("normalizes translation provider aliases", () => {
  assert.equal(normalizeTranslationProvider("OpenAI"), "openai");
  assert.equal(normalizeTranslationProvider("custom"), "openai-compatible");
  assert.equal(normalizeTranslationProvider("compatible"), "openai-compatible");
  assert.equal(normalizeTranslationProvider("unknown"), null);
});

test("uses GPT-5.5 as the OpenAI default translation model", () => {
  const config = resolveTranslationProviderConfig({
    env: { TRANSLATION_PROVIDER: "openai", OPENAI_API_KEY: "key" },
  });

  assert.equal(config.provider, "openai");
  assert.equal(config.model, DEFAULT_OPENAI_TRANSLATION_MODEL);
  assert.equal(config.model, "gpt-5.5");
});

test("prefers project language model settings over environment defaults", () => {
  const encrypted = encryptSecret("project-key", secretEnv);
  const config = resolveTranslationProviderConfig({
    settings: {
      translationProvider: "openrouter",
      translationModel: "anthropic/claude-sonnet-4.6",
      translationBaseUrl: "https://openrouter.ai/api/v1",
      translationApiKeyEncrypted: encrypted,
    },
    env: {
      ...secretEnv,
      TRANSLATION_PROVIDER: "openai",
      OPENAI_API_KEY: "env-key",
      OPENAI_TRANSLATION_MODEL: "gpt-5.4-mini",
    },
  });

  assert.deepEqual(config, {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4.6",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "project-key",
  });
});

test("serializes GET and PATCH language-model API payloads without key material", () => {
  const encrypted = encryptSecret("project-api-key", secretEnv);
  const settings = {
    translationProvider: "openrouter",
    translationModel: "openai/gpt-5.5",
    translationBaseUrl: "https://openrouter.ai/api/v1",
    translationApiKeyEncrypted: encrypted,
  };
  const effective = resolveTranslationProviderConfig({
    settings,
    env: {
      ...secretEnv,
      TRANSLATION_PROVIDER: "openai",
      OPENAI_API_KEY: "workspace-api-key",
    },
  });

  const getPayload = serializeLanguageModelApiResponse({
    settings,
    effective,
    includeProviders: true,
  });
  const patchPayload = serializeLanguageModelApiResponse({ settings, effective });

  for (const payload of [getPayload, patchPayload]) {
    const json = JSON.stringify(payload);

    assert.equal(json.includes("project-api-key"), false);
    assert.equal(json.includes("workspace-api-key"), false);
    assert.equal(json.includes(encrypted), false);
    assert.equal(payload.settings.hasProjectApiKey, true);
    assert.equal(payload.effective.hasApiKey, true);
    assert.equal("apiKey" in payload.effective, false);
  }
  assert.ok(getPayload.providers?.some((provider) => provider.id === "openrouter"));
  assert.equal(patchPayload.providers, undefined);
});

test("supports Ollama without a dedicated API key", () => {
  const config = resolveTranslationProviderConfig({
    env: {
      TRANSLATION_PROVIDER: "ollama",
      OLLAMA_BASE_URL: "http://ollama.internal:11434/v1",
      OLLAMA_TRANSLATION_MODEL: "llama3.3",
    },
  });

  assert.deepEqual(config, {
    provider: "ollama",
    model: "llama3.3",
    baseUrl: "http://ollama.internal:11434/v1",
    apiKey: "ollama",
  });
});

test("validates missing API keys for hosted providers", () => {
  assert.throws(
    () =>
      validateTranslationProviderConfig({
        provider: "openai",
        model: "gpt-5.5",
        baseUrl: "https://api.openai.com/v1",
      }),
    {
      message: "OpenAI API key is not configured.",
    }
  );
});
