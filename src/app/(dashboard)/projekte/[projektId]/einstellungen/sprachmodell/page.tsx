import { notFound, redirect } from "next/navigation";
import { Cpu, ShieldCheck, Sparkles } from "lucide-react";

import { LanguageModelSettingsCard } from "@/components/projekte/language-model-settings-card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userCanManageProject } from "@/lib/project-access";
import { getRequestLocale } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";
import {
  TRANSLATION_PROVIDERS,
  getProviderLabel,
  getRecommendedModels,
  resolveTranslationProviderConfig,
} from "@/lib/translation-config";
import { uiText } from "@/lib/static-copy";

type SprachmodellPageProps = {
  params: Promise<{ projektId: string }>;
};

export default async function SprachmodellPage({ params }: SprachmodellPageProps) {
  const locale = await getRequestLocale();
  const session = await auth();
  if (!session?.user?.id) {
    redirect(withLocalePrefix("/login", locale));
  }

  const { projektId } = await params;
  if (!(await userCanManageProject(session.user.id, projektId))) {
    notFound();
  }

  const project = await db.project.findFirst({
    where: { id: projektId },
    include: { settings: true },
  });

  if (!project) {
    notFound();
  }

  const effective = resolveTranslationProviderConfig({ settings: project.settings });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-sm font-medium text-indigo-600">
          {uiText(locale, "Provider & model", "Anbieter & Modell")}
        </p>
        <h2 className="mt-1 text-2xl font-bold text-gray-900">
          {uiText(locale, "Language model", "Sprachmodell")}
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          {uiText(locale, "Configure OpenAI, OpenRouter, Ollama, DeepL, or any OpenAI-compatible provider per project.", "Konfiguriere OpenAI, OpenRouter, Ollama, DeepL oder jeden OpenAI-kompatiblen Anbieter pro Projekt.")}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <Sparkles className="h-5 w-5 text-indigo-600" />
          <p className="mt-3 text-sm font-semibold text-gray-900">
            {uiText(locale, "Current OpenAI series", "Aktuelle OpenAI-Serie")}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {uiText(locale, "Default: gpt-5-mini for best cost/quality. Pro/flagship models like gpt-5.5 are opt-in.", "Standard: gpt-5-mini für beste Kosten/Qualität. Pro/Flagship-Modelle wie gpt-5.5 sind opt-in.")}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <Cpu className="h-5 w-5 text-indigo-600" />
          <p className="mt-3 text-sm font-semibold text-gray-900">
            {uiText(locale, "Gateway-ready", "Gateway-fähig")}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {uiText(locale, "OpenRouter, Ollama, LiteLLM, LM Studio, or custom OpenAI-compatible endpoints.", "OpenRouter, Ollama, LiteLLM, LM Studio oder eigene OpenAI-kompatible Endpoints.")}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <ShieldCheck className="h-5 w-5 text-indigo-600" />
          <p className="mt-3 text-sm font-semibold text-gray-900">
            {uiText(locale, "Protected keys", "Schlüssel geschützt")}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {uiText(locale, "Project API keys are stored encrypted at rest.", "Projekt-API-Keys werden verschlüsselt gespeichert.")}
          </p>
        </div>
      </div>

      <LanguageModelSettingsCard
        projectId={project.id}
        locale={locale}
        initialSettings={{
          provider: project.settings?.translationProvider ?? null,
          model: project.settings?.translationModel ?? null,
          baseUrl: project.settings?.translationBaseUrl ?? null,
          hasProjectApiKey: Boolean(project.settings?.translationApiKeyEncrypted),
        }}
        initialEffective={{
          provider: effective.provider,
          providerLabel: getProviderLabel(effective.provider),
          model: effective.model ?? null,
          baseUrl: effective.baseUrl ?? null,
          hasApiKey: Boolean(effective.apiKey),
        }}
        providers={TRANSLATION_PROVIDERS.map((provider) => ({
          id: provider,
          label: getProviderLabel(provider),
          recommendedModels: getRecommendedModels(provider),
        }))}
      />
    </div>
  );
}
