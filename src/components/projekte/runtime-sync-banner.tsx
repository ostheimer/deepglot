import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ExternalLink } from "lucide-react";
import Link from "next/link";

import { DismissSyncOriginButton } from "@/components/projekte/dismiss-sync-origin-button";
import { Button } from "@/components/ui/button";
import { getDateFnsLocale } from "@/lib/locale-formatting";
import { getProjectUrl } from "@/lib/project-url";
import { hasRuntimeSyncDomainConflict } from "@/lib/plugin-settings-sync";
import { withLocalePrefix } from "@/lib/site-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type RuntimeSyncBannerProps = {
  locale: SiteLocale;
  domain: string;
  runtimeSyncedAt?: Date | null;
  source?: "wordpress-runtime" | "saas-general";
  syncSiteHost?: string | null;
  syncConflicts?: readonly string[] | null;
  projectId?: string;
};

export function RuntimeSyncBanner({
  locale,
  domain,
  runtimeSyncedAt,
  source = "wordpress-runtime",
  syncSiteHost,
  syncConflicts,
  projectId,
}: RuntimeSyncBannerProps) {
  const domainConflict = hasRuntimeSyncDomainConflict(
    domain,
    syncSiteHost,
    syncConflicts,
  );
  const wpSettingsUrl = `${getProjectUrl(domain)}/wp-admin/options-general.php?page=deepglot`;

  const syncedLabel = runtimeSyncedAt
    ? formatDistanceToNow(runtimeSyncedAt, {
        addSuffix: true,
        locale: getDateFnsLocale(locale),
      })
    : null;
  const saasGeneral = source === "saas-general";

  return (
    <div className="space-y-3">
    {domainConflict ? (
      <div
        role="alert"
        className="flex flex-col gap-4 rounded-xl border border-amber-300 bg-amber-50 p-4 md:flex-row md:items-center md:justify-between"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {uiText(
                locale,
                "Plugin reports a different website",
                "Plugin meldet eine andere Website",
              )}
            </p>
            <p className="mt-1 text-sm text-amber-800">
              {uiText(
                locale,
                "The last sync came from {host}, but this project belongs to {domain}. Another WordPress installation is probably using this project's API key. Create a separate project for it or correct the domain in the general settings.",
                "Die letzte Synchronisierung kam von {host}, dieses Projekt gehört aber zu {domain}. Vermutlich verwendet eine andere WordPress-Installation den API-Key dieses Projekts. Lege dafür ein eigenes Projekt an oder korrigiere die Domain in den allgemeinen Einstellungen.",
              )
                .replace("{host}", syncSiteHost)
                .replace("{domain}", domain)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {projectId ? <DismissSyncOriginButton projectId={projectId} /> : null}
          <Button asChild variant="outline">
            <Link href={withLocalePrefix("/projekte/neu", locale)}>
              {uiText(locale, "Create project", "Projekt erstellen")}
            </Link>
          </Button>
        </div>
      </div>
    ) : null}
    <div className="flex flex-col gap-4 rounded-xl border border-blue-200 bg-blue-50 p-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm font-semibold text-blue-900">
          {saasGeneral
            ? uiText(
                locale,
                "Deepglot is the source of truth for general settings",
                "Deepglot ist die Quelle für allgemeine Einstellungen",
              )
            : uiText(
                locale,
                "WordPress is the source of truth for runtime settings",
                "WordPress ist die Quelle für Runtime-Einstellungen",
              )}
        </p>
        <p className="mt-1 text-sm text-blue-700">
          {saasGeneral
            ? runtimeSyncedAt
              ? uiText(
                  locale,
                  "Last WordPress sync {time}. General settings are saved here and delivered to the plugin through runtime configuration.",
                  "Letzte WordPress-Synchronisierung {time}. Allgemeine Einstellungen werden hier gespeichert und über die Runtime-Konfiguration an das Plugin übertragen.",
                ).replace("{time}", syncedLabel ?? "")
              : uiText(
                  locale,
                  "No WordPress sync received yet. General settings are saved here and will be delivered when the plugin connects.",
                  "Noch keine WordPress-Synchronisierung empfangen. Allgemeine Einstellungen werden hier gespeichert und übertragen, sobald sich das Plugin verbindet.",
                )
            : runtimeSyncedAt
              ? uiText(
                  locale,
                  "Last synced {time}. Changes are saved in the plugin and mirrored here.",
                  "Zuletzt synchronisiert {time}. Änderungen werden im Plugin gespeichert und hier gespiegelt.",
                ).replace("{time}", syncedLabel ?? "")
              : uiText(
                  locale,
                  "No plugin sync received yet. Save the settings in the WordPress plugin to update the mirrored state.",
                  "Noch keine Plugin-Synchronisierung empfangen. Speichere die Einstellungen im WordPress-Plugin, um den Spiegelstand zu aktualisieren.",
                )}
        </p>
      </div>
      <Button asChild className="bg-brand-600 hover:bg-brand-700">
        <a href={wpSettingsUrl} target="_blank" rel="noreferrer">
          <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
          {uiText(
            locale,
            "Open WordPress settings",
            "WordPress-Einstellungen öffnen",
          )}
        </a>
      </Button>
    </div>
    </div>
  );
}
