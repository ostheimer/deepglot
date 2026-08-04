"use client";

import { useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type DigestMembership = {
  organizationId: string;
  organizationName: string;
  enabled: boolean;
};

export function ActivityDigestPreferences({
  locale,
  memberships,
}: {
  locale: SiteLocale;
  memberships: DigestMembership[];
}) {
  const [enabledByOrganization, setEnabledByOrganization] = useState(
    Object.fromEntries(
      memberships.map((membership) => [
        membership.organizationId,
        membership.enabled,
      ])
    )
  );
  const [savingOrganizationId, setSavingOrganizationId] = useState<
    string | null
  >(null);

  async function updatePreference(membership: DigestMembership) {
    if (savingOrganizationId) return;
    const next = !enabledByOrganization[membership.organizationId];
    setSavingOrganizationId(membership.organizationId);

    try {
      const response = await fetch("/api/user/activity-digest", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: membership.organizationId,
          enabled: next,
          locale,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { enabled?: boolean; error?: string }
        | null;

      if (!response.ok || typeof payload?.enabled !== "boolean") {
        throw new Error(
          payload?.error ??
            uiText(
              locale,
              "The weekly digest setting could not be saved.",
              "Die Einstellung für den Wochenrückblick konnte nicht gespeichert werden."
            )
        );
      }

      setEnabledByOrganization((current) => ({
        ...current,
        [membership.organizationId]: payload.enabled as boolean,
      }));
      toast.success(
        payload.enabled
          ? uiText(
              locale,
              "Weekly digest enabled",
              "Wochenrückblick aktiviert"
            )
          : uiText(
              locale,
              "Weekly digest disabled",
              "Wochenrückblick deaktiviert"
            )
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : uiText(
              locale,
              "The weekly digest setting could not be saved.",
              "Die Einstellung für den Wochenrückblick konnte nicht gespeichert werden."
            )
      );
    } finally {
      setSavingOrganizationId(null);
    }
  }

  return (
    <div className="border-t border-gray-100">
      <div className="px-5 py-4">
        <p className="text-sm font-medium text-gray-900">
          {uiText(
            locale,
            "Project and workspace activity",
            "Projekt- und Workspace-Aktivität"
          )}
        </p>
        <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-gray-500">
          {uiText(
            locale,
            "Receive one email on Monday with the previous complete week's new translations, manual edits, and translation requests. Quiet weeks are skipped.",
            "Erhalte montags eine E-Mail mit neuen Übersetzungen, manuellen Bearbeitungen und Übersetzungsanfragen der letzten vollständigen Woche. Wochen ohne Aktivität werden übersprungen."
          )}
        </p>
      </div>

      {memberships.length === 0 ? (
        <p className="border-t border-gray-100 px-5 py-4 text-xs text-gray-500">
          {uiText(
            locale,
            "Join a workspace to enable its weekly digest.",
            "Tritt einem Workspace bei, um dessen Wochenrückblick zu aktivieren."
          )}
        </p>
      ) : (
        <div className="divide-y divide-gray-100 border-t border-gray-100 bg-gray-50">
          {memberships.map((membership) => {
            const enabled =
              enabledByOrganization[membership.organizationId] ?? false;
            const saving =
              savingOrganizationId === membership.organizationId;
            const label = `${uiText(
              locale,
              "Project and workspace activity",
              "Projekt- und Workspace-Aktivität"
            )}: ${membership.organizationName}`;

            return (
              <div
                key={membership.organizationId}
                className="flex items-center justify-between gap-4 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800">
                    {membership.organizationName}
                  </p>
                  <p className="text-xs text-gray-500">
                    {enabled
                      ? uiText(locale, "Active", "Aktiv")
                      : uiText(locale, "Off", "Aus")}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={label}
                  disabled={saving}
                  onClick={() => updatePreference(membership)}
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                    enabled ? "bg-brand-600" : "bg-gray-200",
                    saving && "cursor-not-allowed opacity-50"
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                      enabled ? "translate-x-4" : "translate-x-0"
                    )}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
