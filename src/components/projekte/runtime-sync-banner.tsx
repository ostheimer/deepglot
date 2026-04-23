import { formatDistanceToNow } from "date-fns";
import { de, enUS } from "date-fns/locale";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getProjectUrl } from "@/lib/project-url";

type RuntimeSyncBannerProps = {
  locale: "en" | "de";
  domain: string;
  runtimeSyncedAt?: Date | null;
};

export function RuntimeSyncBanner({
  locale,
  domain,
  runtimeSyncedAt,
}: RuntimeSyncBannerProps) {
  const wpSettingsUrl = `${getProjectUrl(
    domain
  )}/wp-admin/options-general.php?page=deepglot`;

  const syncedLabel = runtimeSyncedAt
    ? formatDistanceToNow(runtimeSyncedAt, {
        addSuffix: true,
        locale: locale === "de" ? de : enUS,
      })
    : null;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-blue-200 bg-blue-50 p-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm font-semibold text-blue-900">
          {locale === "de"
            ? "WordPress ist die Quelle für Runtime-Einstellungen"
            : "WordPress is the source of truth for runtime settings"}
        </p>
        <p className="mt-1 text-sm text-blue-700">
          {runtimeSyncedAt
            ? locale === "de"
              ? `Zuletzt synchronisiert ${syncedLabel}. Änderungen werden im Plugin gespeichert und hier gespiegelt.`
              : `Last synced ${syncedLabel}. Changes are saved in the plugin and mirrored here.`
            : locale === "de"
              ? "Noch keine Plugin-Synchronisierung empfangen. Speichere die Einstellungen im WordPress-Plugin, um den Spiegelstand zu aktualisieren."
              : "No plugin sync received yet. Save the settings in the WordPress plugin to update the mirrored state."}
        </p>
      </div>
      <Button asChild className="bg-indigo-600 hover:bg-indigo-700">
        <a href={wpSettingsUrl} target="_blank" rel="noreferrer">
          <ExternalLink className="mr-2 h-4 w-4" />
          {locale === "de"
            ? "WordPress-Einstellungen öffnen"
            : "Open WordPress settings"}
        </a>
      </Button>
    </div>
  );
}
