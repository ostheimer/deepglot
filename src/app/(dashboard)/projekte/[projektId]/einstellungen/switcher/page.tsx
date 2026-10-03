import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { requireProjectManagement } from "@/lib/project-page-access";
import { getRequestLocale } from "@/lib/request-locale";
import { getProjectUrl } from "@/lib/project-url";
import { RuntimeSyncBanner } from "@/components/projekte/runtime-sync-banner";
import { SwitcherEditor } from "@/components/projekte/switcher-editor";
import { normalizeSwitcherConfigLanguages, switcherConfigSchema } from "@/lib/switcher-contract";
import { uiText } from "@/lib/static-copy";

export default async function SwitcherPage({ params }: { params: Promise<{ projektId: string }> }) {
  const { projektId } = await params;
  const locale = await getRequestLocale();
  await requireProjectManagement(projektId);
  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { settings: true, languages: { where: { isActive: true }, orderBy: { langCode: "asc" } } },
  });
  if (!project) notFound();
  const s = project.settings;
  const owner = s?.switcherOwner ?? "wordpress";
  const parsed = switcherConfigSchema.safeParse(owner === "saas" ? s?.switcherConfig : s?.switcherPluginConfig);
  const languages = [project.originalLang, ...project.languages.map((language) => language.langCode)];
  const config = parsed.success ? normalizeSwitcherConfigLanguages(parsed.data, languages) : null;

  return <div className="max-w-3xl space-y-5">
    <h2 className="text-xl font-bold text-gray-900">{uiText(locale, "Language switcher", "Sprachauswahl")}</h2>
    <RuntimeSyncBanner
      locale={locale} domain={project.domain} runtimeSyncedAt={s?.runtimeSyncedAt} source="switcher-only"
      syncSiteHost={s?.runtimeSyncSiteHost} syncConflicts={s?.runtimeSyncConflicts} projectId={projektId}
    />
    <SwitcherEditor
      projectId={projektId} locale={locale} initialOwner={owner} initialRevision={s?.switcherRevision ?? 0}
      initialConfig={config} pluginSyncedAt={s?.switcherPluginSyncedAt?.toISOString() ?? null}
      pluginRevision={s?.switcherPluginRevision ?? null} conflict={s?.switcherConflict ?? false}
      languages={languages} wpSettingsUrl={`${getProjectUrl(project.domain)}/wp-admin/options-general.php?page=deepglot`}
    />
  </div>;
}
