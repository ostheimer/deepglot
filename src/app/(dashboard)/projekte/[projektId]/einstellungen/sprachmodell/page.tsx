import { notFound, redirect } from "next/navigation";
import { Cpu, ShieldCheck, Sparkles } from "lucide-react";

import { LanguageModelSettingsCard } from "@/components/projekte/language-model-settings-card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userCanManageProject } from "@/lib/project-access";
import { getRequestLocale } from "@/lib/request-locale";
import {
  TRANSLATION_PROVIDERS,
  getProviderLabel,
  getRecommendedModels,
  resolveTranslationProviderConfig,
} from "@/lib/translation-config";

type SprachmodellPageProps = {
  params: Promise<{ projektId: string }>;
};

export default async function SprachmodellPage({ params }: SprachmodellPageProps) {
  const locale = await getRequestLocale();
  const session = await auth();
  if (!session?.user?.id) {
    redirect(locale === "de" ? "/de/login" : "/login");
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
          {locale === "de" ? "Anbieter & Modell" : "Provider & model"}
        </p>
        <h2 className="mt-1 text-2xl font-bold text-gray-900">
          {locale === "de" ? "Sprachmodell" : "Language model"}
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          {locale === "de"
            ? "Konfiguriere OpenAI, OpenRouter, Ollama, DeepL oder jeden OpenAI-kompatiblen Anbieter pro Projekt."
            : "Configure OpenAI, OpenRouter, Ollama, DeepL, or any OpenAI-compatible provider per project."}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <Sparkles className="h-5 w-5 text-indigo-600" />
          <p className="mt-3 text-sm font-semibold text-gray-900">
            {locale === "de" ? "Aktuelle OpenAI-Serie" : "Current OpenAI series"}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {locale === "de"
              ? "Standard: gpt-5.5, mit Mini-/Nano-Optionen für Kostenkontrolle."
              : "Default: gpt-5.5, with mini/nano options for cost control."}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <Cpu className="h-5 w-5 text-indigo-600" />
          <p className="mt-3 text-sm font-semibold text-gray-900">
            {locale === "de" ? "Gateway-fähig" : "Gateway-ready"}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {locale === "de"
              ? "OpenRouter, Ollama, LiteLLM, LM Studio oder eigene OpenAI-kompatible Endpoints."
              : "OpenRouter, Ollama, LiteLLM, LM Studio, or custom OpenAI-compatible endpoints."}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <ShieldCheck className="h-5 w-5 text-indigo-600" />
          <p className="mt-3 text-sm font-semibold text-gray-900">
            {locale === "de" ? "Schlüssel geschützt" : "Protected keys"}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {locale === "de"
              ? "Projekt-API-Keys werden verschlüsselt gespeichert."
              : "Project API keys are stored encrypted at rest."}
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
