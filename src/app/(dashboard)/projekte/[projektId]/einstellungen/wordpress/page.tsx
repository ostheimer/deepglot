import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { getRequestLocale } from "@/lib/request-locale";
import { Badge } from "@/components/ui/badge";
import { RuntimeSyncBanner } from "@/components/projekte/runtime-sync-banner";
import { requireProjectManagement } from "@/lib/project-page-access";
import { uiText } from "@/lib/static-copy";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function WordPressSettingsPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();
  await requireProjectManagement(projektId);

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: {
      settings: true,
      languages: {
        where: { isActive: true },
        orderBy: { langCode: "asc" },
      },
      domainMappings: {
        orderBy: { langCode: "asc" },
      },
    },
  });
  if (!project) notFound();

  const s = project.settings;

  return (
    <div className="max-w-3xl space-y-5">
      <h2 className="text-xl font-bold text-gray-900 mb-6">
        {uiText(locale, "WordPress settings", "WordPress-Einstellungen")}
      </h2>

      <RuntimeSyncBanner
        locale={locale}
        domain={project.domain}
        runtimeSyncedAt={s?.runtimeSyncedAt}
      />

      <section className="grid gap-4 md:grid-cols-2">
        {[
          {
            label:
              uiText(locale, "Translate emails", "E-Mails übersetzen"),
            value: s?.translateEmails ?? false,
            description:
              uiText(locale, "WooCommerce and wp_mail emails follow the runtime configuration stored in the plugin.", "WooCommerce- und wp_mail-E-Mails folgen der im Plugin gespeicherten Runtime-Konfiguration."),
          },
          {
            label:
              uiText(locale, "Translate search", "Suche übersetzen"),
            value: s?.translateSearch ?? false,
            description:
              uiText(locale, "Search requests are handled in the visitor's current language.", "Suchanfragen werden in der aktuellen Besuchersprache verarbeitet."),
          },
          {
            label: uiText(locale, "Translate AMP", "AMP übersetzen"),
            value: s?.translateAmp ?? false,
            description:
              uiText(locale, "AMP pages are translated only when the plugin option is enabled.", "AMP-Seiten werden nur übersetzt, wenn die Plugin-Option aktiv ist."),
          },
          {
            label:
              uiText(locale, "Browser redirect", "Browser-Weiterleitung"),
            value: s?.autoSwitch ?? false,
            description:
              uiText(locale, "First-time visitors can optionally be redirected from Accept-Language.", "Erstbesucher werden optional anhand von Accept-Language weitergeleitet."),
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-gray-200 bg-white p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                <p className="mt-1 text-sm text-gray-500">{item.description}</p>
              </div>
              <Badge
                className={
                  item.value
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-gray-100 text-gray-600"
                }
              >
                {item.value
                  ? uiText(locale, "Enabled", "Aktiv")
                  : uiText(locale, "Off", "Aus")}
              </Badge>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-base font-semibold text-gray-900">
          {uiText(locale, "Routing & domains", "Routing & Domains")}
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          {uiText(locale, "Path-prefix is the default. Subdomain mode requires a host mapping for every active target language.", "Pfad-Präfix ist Standard. Für Subdomains muss jede aktive Zielsprache einem Host zugeordnet sein.")}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge className="bg-indigo-50 text-indigo-700">
            {s?.routingMode === "SUBDOMAIN"
              ? uiText(locale, "Subdomains", "Subdomains")
              : uiText(locale, "Path prefix", "Pfad-Präfix")}
          </Badge>
          <Badge variant="outline">{project.originalLang.toUpperCase()}</Badge>
          {project.languages.map((language) => (
            <Badge key={language.id} variant="secondary">
              {language.langCode.toUpperCase()}
            </Badge>
          ))}
        </div>

        <div className="mt-5 overflow-hidden rounded-lg border border-gray-100">
          <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            <span>{uiText(locale, "Language", "Sprache")}</span>
            <span>Host</span>
          </div>
          {project.languages.map((language) => {
            const mapping = project.domainMappings.find(
              (item) => item.langCode === language.langCode
            );

            return (
              <div
                key={language.id}
                className="grid grid-cols-[120px_1fr] gap-3 border-b border-gray-100 px-4 py-3 text-sm last:border-0"
              >
                <span className="font-medium text-gray-700">
                  {language.langCode.toUpperCase()}
                </span>
                <span className="text-gray-600">
                  {mapping?.host ??
                    (uiText(locale, "No mapping", "Keine Zuordnung"))}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
