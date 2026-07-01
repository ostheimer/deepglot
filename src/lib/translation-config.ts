import { decryptSecret } from "@/lib/secret-encryption";
import type { TranslationProviderName } from "@/lib/translation-types";

/**
 * Default OpenAI model used for website translation.
 *
 * Translation is a low-complexity task where Frontier models are wasted
 * budget. gpt-5-mini delivers production-quality DE↔EN at ~1/15 the cost
 * of gpt-5.5 ($0.25 / $2 per 1M tokens vs $5 / $30) with no measurable
 * quality drop on web copy. Operators that need higher quality can
 * override via `OPENAI_TRANSLATION_MODEL` or switch to a different
 * provider in the project settings.
 */
export const DEFAULT_OPENAI_TRANSLATION_MODEL = "gpt-5-mini";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENROUTER_TRANSLATION_MODEL = "openai/gpt-5-mini";
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";
export const DEFAULT_OLLAMA_TRANSLATION_MODEL = "llama3.3";
/**
 * Default Gemini model for translation. Google recommends the stable
 * `gemini-3.1-flash-lite` (GA since March 2026) for high-volume translation
 * workloads — twice as fast as 2.5-flash-lite, better quality on translation /
 * RAG / data-extraction benchmarks, and still in the cheap tier ($0.25 input /
 * $1.50 output per 1M tokens).
 *
 * NB: keep this on the stable model id, never a `-preview` alias. Google
 * retires preview aliases once the stable ships, and because Gemini is the
 * default fallback in `buildFallbackProviderChain`, a retired model id makes
 * the whole openai -> gemini chain fail (every /api/translate call 500s).
 */
export const DEFAULT_GEMINI_TRANSLATION_MODEL = "gemini-3.1-flash-lite";
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export const TRANSLATION_PROVIDERS = [
  "openai",
  "gemini",
  "openrouter",
  "ollama",
  "openai-compatible",
  "deepl",
  "mock",
] as const satisfies readonly TranslationProviderName[];

export type TranslationSettingsLike = {
  translationProvider?: string | null;
  translationModel?: string | null;
  translationBaseUrl?: string | null;
  translationApiKeyEncrypted?: string | null;
};

export type TranslationProviderConfig = {
  provider: TranslationProviderName;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
};

export type LanguageModelApiResponse = {
  settings: {
    provider: string | null;
    model: string | null;
    baseUrl: string | null;
    hasProjectApiKey: boolean;
  };
  effective: {
    provider: TranslationProviderName;
    providerLabel: string;
    model: string | null;
    baseUrl: string | null;
    hasApiKey: boolean;
  };
  providers?: Array<{
    id: TranslationProviderName;
    label: string;
    recommendedModels: string[];
  }>;
};

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeTranslationProvider(
  provider: string | null | undefined
): TranslationProviderName | null {
  const normalized = clean(provider)?.toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "custom" || normalized === "compatible") {
    return "openai-compatible";
  }
  if ((TRANSLATION_PROVIDERS as readonly string[]).includes(normalized)) {
    return normalized as TranslationProviderName;
  }
  return null;
}

function getProjectApiKey(
  settings: TranslationSettingsLike | null | undefined,
  env: Record<string, string | undefined>
) {
  const encrypted = clean(settings?.translationApiKeyEncrypted);
  if (!encrypted) {
    return undefined;
  }

  return decryptSecret(encrypted, env);
}

export function getProviderLabel(provider: TranslationProviderName) {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "gemini":
      return "Google Gemini";
    case "openrouter":
      return "OpenRouter";
    case "ollama":
      return "Ollama";
    case "openai-compatible":
      return "OpenAI-compatible";
    case "deepl":
      return "DeepL";
    case "mock":
      return "Mock";
  }
}

export function getRecommendedModels(provider: TranslationProviderName) {
  switch (provider) {
    case "openai":
      return [
        // Default for translation — best $/quality ratio.
        "gpt-5-mini",
        "gpt-4.1-nano",
        "gpt-5.4-mini",
        "gpt-5.4",
        "gpt-5.5",
      ];
    case "gemini":
      return [
        // Default for translation — Google's high-volume, low-cost model (stable).
        "gemini-3.1-flash-lite",
        // Near-Pro quality at Flash-tier cost & speed (stable) — quality upgrade.
        "gemini-3.5-flash",
        // Previous-generation models, still GA.
        "gemini-2.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-2.5-pro",
      ];
    case "openrouter":
      return [
        "openai/gpt-5-mini",
        "openai/gpt-5.4-mini",
        "anthropic/claude-sonnet-4.6",
        "google/gemini-3-pro",
        "openai/gpt-5.5",
      ];
    case "ollama":
      return ["llama3.3", "qwen2.5", "mistral", "gemma3"];
    case "openai-compatible":
      return ["model-id-from-your-gateway"];
    case "deepl":
    case "mock":
      return [];
  }
}

export function serializeLanguageModelApiResponse({
  settings,
  effective,
  includeProviders = false,
}: {
  settings: TranslationSettingsLike | null | undefined;
  effective: TranslationProviderConfig;
  includeProviders?: boolean;
}): LanguageModelApiResponse {
  const payload: LanguageModelApiResponse = {
    settings: {
      provider: settings?.translationProvider ?? null,
      model: settings?.translationModel ?? null,
      baseUrl: settings?.translationBaseUrl ?? null,
      hasProjectApiKey: Boolean(settings?.translationApiKeyEncrypted),
    },
    effective: {
      provider: effective.provider,
      providerLabel: getProviderLabel(effective.provider),
      model: effective.model ?? null,
      baseUrl: effective.baseUrl ?? null,
      hasApiKey: Boolean(effective.apiKey),
    },
  };

  if (includeProviders) {
    payload.providers = TRANSLATION_PROVIDERS.map((provider) => ({
      id: provider,
      label: getProviderLabel(provider),
      recommendedModels: getRecommendedModels(provider),
    }));
  }

  return payload;
}

export function resolveTranslationProviderConfig({
  settings,
  env = process.env,
}: {
  settings?: TranslationSettingsLike | null;
  env?: Record<string, string | undefined>;
} = {}): TranslationProviderConfig {
  const rawProjectProvider = clean(settings?.translationProvider);
  const rawEnvProvider = clean(env.TRANSLATION_PROVIDER);
  const configuredProjectProvider = normalizeTranslationProvider(rawProjectProvider);
  const configuredEnvProvider = normalizeTranslationProvider(rawEnvProvider);

  if (rawProjectProvider && !configuredProjectProvider) {
    throw new Error(
      `Unknown project translation provider '${rawProjectProvider}'. Allowed providers: ${TRANSLATION_PROVIDERS.join(", ")}.`
    );
  }
  if (rawEnvProvider && !configuredEnvProvider) {
    throw new Error(
      `Unknown TRANSLATION_PROVIDER '${rawEnvProvider}'. Allowed providers: ${TRANSLATION_PROVIDERS.join(", ")}.`
    );
  }
  const provider =
    configuredProjectProvider ??
    configuredEnvProvider ??
    (env.GEMINI_API_KEY
      ? "gemini"
      : env.OPENAI_API_KEY
        ? "openai"
        : env.OPENROUTER_API_KEY
          ? "openrouter"
          : env.DEEPL_API_KEY
            ? "deepl"
            : env.OLLAMA_BASE_URL
              ? "ollama"
              : env.NODE_ENV === "development" || env.NODE_ENV === "test"
                ? "mock"
                : null);

  if (!provider) {
    throw new Error(
      "No translation provider configured. Set TRANSLATION_PROVIDER or configure a project language model."
    );
  }

  const projectModel = clean(settings?.translationModel);
  const projectBaseUrl = clean(settings?.translationBaseUrl);
  const projectApiKey = getProjectApiKey(settings, env);

  switch (provider) {
    case "openai":
      return {
        provider,
        model:
          projectModel ||
          clean(env.OPENAI_TRANSLATION_MODEL) ||
          clean(env.TRANSLATION_MODEL) ||
          DEFAULT_OPENAI_TRANSLATION_MODEL,
        baseUrl: projectBaseUrl || clean(env.OPENAI_BASE_URL) || DEFAULT_OPENAI_BASE_URL,
        apiKey: projectApiKey || clean(env.OPENAI_API_KEY) || clean(env.TRANSLATION_API_KEY),
      };
    case "gemini":
      return {
        provider,
        model:
          projectModel ||
          clean(env.GEMINI_TRANSLATION_MODEL) ||
          clean(env.TRANSLATION_MODEL) ||
          DEFAULT_GEMINI_TRANSLATION_MODEL,
        baseUrl:
          projectBaseUrl || clean(env.GEMINI_BASE_URL) || DEFAULT_GEMINI_BASE_URL,
        apiKey:
          projectApiKey || clean(env.GEMINI_API_KEY) || clean(env.TRANSLATION_API_KEY),
      };
    case "openrouter":
      return {
        provider,
        model:
          projectModel ||
          clean(env.OPENROUTER_TRANSLATION_MODEL) ||
          clean(env.TRANSLATION_MODEL) ||
          DEFAULT_OPENROUTER_TRANSLATION_MODEL,
        baseUrl:
          projectBaseUrl ||
          clean(env.OPENROUTER_BASE_URL) ||
          DEFAULT_OPENROUTER_BASE_URL,
        apiKey:
          projectApiKey || clean(env.OPENROUTER_API_KEY) || clean(env.TRANSLATION_API_KEY),
      };
    case "ollama":
      return {
        provider,
        model:
          projectModel ||
          clean(env.OLLAMA_TRANSLATION_MODEL) ||
          clean(env.TRANSLATION_MODEL) ||
          DEFAULT_OLLAMA_TRANSLATION_MODEL,
        baseUrl: projectBaseUrl || clean(env.OLLAMA_BASE_URL) || DEFAULT_OLLAMA_BASE_URL,
        apiKey: projectApiKey || clean(env.OLLAMA_API_KEY) || "ollama",
      };
    case "openai-compatible":
      return {
        provider,
        model: projectModel || clean(env.TRANSLATION_MODEL),
        baseUrl: projectBaseUrl || clean(env.TRANSLATION_BASE_URL),
        apiKey: projectApiKey || clean(env.TRANSLATION_API_KEY),
      };
    case "deepl":
      return {
        provider,
        apiKey: projectApiKey || clean(env.DEEPL_API_KEY),
      };
    case "mock":
      return { provider };
  }
}

export function validateTranslationProviderConfig(config: TranslationProviderConfig) {
  if (config.provider === "mock") {
    return;
  }
  if (config.provider === "deepl") {
    if (!config.apiKey) {
      throw new Error("DEEPL_API_KEY is not configured.");
    }
    return;
  }
  if (!config.model) {
    throw new Error("Translation model is not configured.");
  }
  if (!config.baseUrl) {
    throw new Error("Translation provider base URL is not configured.");
  }
  if (!config.apiKey) {
    throw new Error(`${getProviderLabel(config.provider)} API key is not configured.`);
  }
}

/**
 * Builds the ordered provider chain `translateTexts` walks when one
 * provider returns a quota / rate-limit / 5xx error. The first entry is
 * always the active primary config. Additional entries come from the
 * comma-separated `TRANSLATION_FALLBACK_PROVIDERS` env var (or default to
 * the implicit chain `gemini → openai` so the most common outage
 * combination still serves traffic).
 *
 * Providers that cannot produce a usable config (missing API key, no
 * base URL, no model) are silently skipped — the operator should see the
 * primary failure rather than a wave of misconfiguration errors.
 */
export function buildFallbackProviderChain(
  primary: TranslationProviderConfig,
  env: Record<string, string | undefined> = process.env
): TranslationProviderConfig[] {
  const chain: TranslationProviderConfig[] = [primary];
  const rawList = clean(env.TRANSLATION_FALLBACK_PROVIDERS);
  const candidateNames = rawList
    ? rawList
        .split(",")
        .map((entry) => normalizeTranslationProvider(entry.trim()))
        .filter((entry): entry is TranslationProviderName => entry !== null)
    : DEFAULT_FALLBACK_PROVIDERS.filter((name) => name !== primary.provider);

  for (const candidateName of candidateNames) {
    if (candidateName === primary.provider) continue;
    if (chain.some((entry) => entry.provider === candidateName)) continue;

    const candidate = tryResolveFallbackProvider(candidateName, env);
    if (candidate) {
      chain.push(candidate);
    }
  }

  return chain;
}

const DEFAULT_FALLBACK_PROVIDERS: TranslationProviderName[] = [
  "gemini",
  "openai",
];

function tryResolveFallbackProvider(
  provider: TranslationProviderName,
  env: Record<string, string | undefined>
): TranslationProviderConfig | null {
  try {
    const candidate = resolveTranslationProviderConfig({
      env: { ...env, TRANSLATION_PROVIDER: provider },
    });
    validateTranslationProviderConfig(candidate);
    return candidate;
  } catch {
    return null;
  }
}
