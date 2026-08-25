import { notFound } from "next/navigation";

import {
  ProjectGeneralSettingsForm,
  type ProjectGeneralSettingsFormValue,
} from "@/components/projekte/project-general-settings-form";
import { RuntimeSyncBanner } from "@/components/projekte/runtime-sync-banner";
import { TranslationMemoryToggle } from "@/components/projekte/translation-memory-toggle";
import { db } from "@/lib/db";
import { planSupportsTranslationMemory } from "@/lib/translation-memory";
import { getProjectGeneralSettings } from "@/lib/project-general-settings";
import { requireProjectManagement } from "@/lib/project-page-access";
import { getRequestLocale } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function EinstellungenGeneralPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();
  await requireProjectManagement(projektId);

  const [generalSettings, project] = await Promise.all([
    getProjectGeneralSettings(db, projektId),
    db.project.findUnique({
      where: { id: projektId },
      select: {
        settings: {
          select: {
            runtimeSyncedAt: true,
            translationMemory: true,
          },
        },
        organization: { select: { plan: true } },
      },
    }),
  ]);

  if (!generalSettings || !project) notFound();

  const initialSettings: ProjectGeneralSettingsFormValue = {
    version: generalSettings.version,
    name: generalSettings.name,
    domain: generalSettings.domain,
    sourceLanguage: generalSettings.sourceLanguage,
    targetLanguages: generalSettings.targetLanguages,
    sourceLanguageLocked: generalSettings.sourceLanguageLocked,
    autoRedirect: generalSettings.autoRedirect,
    displayAiNotice: generalSettings.displayAiNotice,
    automaticTranslation: generalSettings.automaticTranslation,
    websiteType: generalSettings.websiteType,
    industryType: generalSettings.industryType,
  };

  return (
    <div className="max-w-3xl space-y-5">
      <h2 className="text-xl font-bold text-gray-900">
        {uiText(locale, "General", "Allgemein")}
      </h2>

      <RuntimeSyncBanner
        locale={locale}
        domain={generalSettings.domain}
        runtimeSyncedAt={project.settings?.runtimeSyncedAt}
        source="saas-general"
      />

      <ProjectGeneralSettingsForm
        key={projektId}
        projectId={projektId}
        locale={locale}
        initialSettings={initialSettings}
      />

      <div className="overflow-hidden rounded-xl border-y border-gray-200">
        <TranslationMemoryToggle
          projectId={projektId}
          locale={locale}
          initialEnabled={project.settings?.translationMemory ?? false}
          eligible={planSupportsTranslationMemory(project.organization.plan)}
        />
      </div>
    </div>
  );
}
