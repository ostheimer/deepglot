import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { getRequestLocale } from "@/lib/request-locale";
import { Badge } from "@/components/ui/badge";
import { RuntimeSyncBanner } from "@/components/projekte/runtime-sync-banner";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function WordPressSettingsPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();

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
        {locale === "de" ? "WordPress-Einstellungen" : "WordPress settings"}
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
              locale === "de"
                ? "E-Mails übersetzen"
                : "Translate emails",
            value: s?.translateEmails ?? false,
            description:
              locale === "de"
                ? "WooCommerce- und wp_mail-E-Mails folgen der im Plugin gespeicherten Runtime-Konfiguration."
                : "WooCommerce and wp_mail emails follow the runtime configuration stored in the plugin.",
          },
          {
            label:
              locale === "de"
                ? "Suche übersetzen"
                : "Translate search",
            value: s?.translateSearch ?? false,
            description:
              locale === "de"
                ? "Suchanfragen werden in der aktuellen Besuchersprache verarbeitet."
                : "Search requests are handled in the visitor's current language.",
          },
          {
            label: locale === "de" ? "AMP übersetzen" : "Translate AMP",
            value: s?.translateAmp ?? false,
            description:
              locale === "de"
                ? "AMP-Seiten werden nur übersetzt, wenn die Plugin-Option aktiv ist."
                : "AMP pages are translated only when the plugin option is enabled.",
          },
          {
            label:
              locale === "de"
                ? "Browser-Weiterleitung"
                : "Browser redirect",
            value: s?.autoSwitch ?? false,
            description:
              locale === "de"
                ? "Erstbesucher werden optional anhand von Accept-Language weitergeleitet."
                : "First-time visitors can optionally be redirected from Accept-Language.",
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
                  ? locale === "de"
                    ? "Aktiv"
                    : "Enabled"
                  : locale === "de"
                    ? "Aus"
                    : "Off"}
              </Badge>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-base font-semibold text-gray-900">
          {locale === "de" ? "Routing & Domains" : "Routing & domains"}
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          {locale === "de"
            ? "Pfad-Präfix ist Standard. Für Subdomains muss jede aktive Zielsprache einem Host zugeordnet sein."
            : "Path-prefix is the default. Subdomain mode requires a host mapping for every active target language."}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge className="bg-indigo-50 text-indigo-700">
            {s?.routingMode === "SUBDOMAIN"
              ? locale === "de"
                ? "Subdomains"
                : "Subdomains"
              : locale === "de"
                ? "Pfad-Präfix"
                : "Path prefix"}
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
            <span>{locale === "de" ? "Sprache" : "Language"}</span>
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
                    (locale === "de" ? "Keine Zuordnung" : "No mapping")}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
