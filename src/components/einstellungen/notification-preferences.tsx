"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { OPTIONAL_NOTIFICATION_CATEGORIES, allowedNotificationFrequencies, type OptionalNotificationCategory, type OptionalNotificationFrequency } from "@/lib/notification-preferences";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type Membership = { organizationId: string; organizationName: string; role: "OWNER" | "ADMIN" | "MEMBER" };
type Preference = { organizationId: string; category: OptionalNotificationCategory; frequency: OptionalNotificationFrequency; locale: string };

const copy: Record<OptionalNotificationCategory, [string, string]> = {
  PRODUCT_UPDATE: ["Product updates", "Produktneuigkeiten"],
  PROJECT_ACTIVITY: ["Project notices", "Projekthinweise"],
  BILLING_SUMMARY: ["Billing summaries", "Abrechnungsübersichten"],
};

export function NotificationPreferences({ locale, memberships }: { locale: SiteLocale; memberships: Membership[] }) {
  const [currentMemberships, setCurrentMemberships] = useState(memberships);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  const [error, setError] = useState(false);

  async function readBack() {
    const response = await fetch("/api/user/notification-preferences", { cache: "no-store" });
    if (!response.ok) throw new Error("readback failed");
    const payload = await response.json() as { memberships: Membership[]; preferences: Preference[] };
    setCurrentMemberships(payload.memberships);
    setPreferences(payload.preferences);
  }

  useEffect(() => {
    readBack().catch(() => setError(true)).finally(() => setLoading(false));
  }, []);

  async function save(organizationId: string, category: OptionalNotificationCategory, frequency: OptionalNotificationFrequency) {
    if (saveInFlight.current || loading) return;
    saveInFlight.current = true;
    const key = `${organizationId}:${category}`;
    setSaving(key);
    try {
      const response = await fetch("/api/user/notification-preferences", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, category, frequency, locale }),
      });
      if (!response.ok) throw new Error("save failed");
      await readBack();
      setError(false);
      toast.success(locale === "de" ? "Einstellung gespeichert" : "Preference saved");
    } catch {
      setError(true);
      toast.error(locale === "de" ? "Die Einstellung konnte nicht gespeichert oder erneut gelesen werden." : "The preference could not be saved or read back.");
    } finally { saveInFlight.current = false; setSaving(null); }
  }

  return <div className="border-t border-gray-100 px-5 py-4">
    <p className="text-sm font-medium text-gray-900">{locale === "de" ? "Optionale Benachrichtigungen" : "Optional notifications"}</p>
    <p className="mt-1 text-xs text-gray-500">{locale === "de"
      ? "Wähle optionale E-Mail-Kategorien je Workspace. Aus meldet dich von der jeweiligen Kategorie ab. Diese neuen Kategorien sind Einstellungen für künftige E-Mail-Dienste; Konto- und Sicherheitshinweise bleiben aktiv."
      : "Choose optional email categories for each workspace. Off unsubscribes from that category. These new categories are preferences for future email services; account and security notices remain active."}</p>
    {loading && <p className="mt-3 text-xs">{locale === "de" ? "Gespeicherte Einstellungen werden geladen …" : "Loading saved preferences…"}</p>}
    {error && <p role="alert" className="mt-3 text-xs text-red-700">{locale === "de" ? "Einstellungen konnten nicht erneut gelesen werden." : "Preferences could not be read back."}</p>}
    {error && <button type="button" className="mt-2 text-xs font-semibold text-brand-600 underline" onClick={() => { setError(false); setLoading(true); readBack().catch(() => setError(true)).finally(() => setLoading(false)); }}>{locale === "de" ? "Erneut versuchen" : "Try again"}</button>}
    {!loading && currentMemberships.map((membership) => <div key={membership.organizationId} className="mt-4 border-t border-gray-100 pt-3">
      <p className="text-sm font-semibold text-gray-800">{membership.organizationName}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {OPTIONAL_NOTIFICATION_CATEGORIES.map((category) => {
          const frequency = preferences.find((entry) => entry.organizationId === membership.organizationId && entry.category === category)?.frequency ?? "OFF";
          return <label key={category} className="text-xs font-medium text-gray-700">
            {uiText(locale, copy[category][0], copy[category][1])}
            <select className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm" aria-label={`${membership.organizationName}: ${uiText(locale, copy[category][0], copy[category][1])}`} value={frequency} disabled={Boolean(saving) || error} onChange={(event) => save(membership.organizationId, category, event.target.value as OptionalNotificationFrequency)}>
              {allowedNotificationFrequencies(category).map((choice) => <option key={choice} value={choice} disabled={category === "BILLING_SUMMARY" && membership.role === "MEMBER" && choice !== "OFF"}>{choice === "OFF" ? uiText(locale, "Off", "Aus") : choice === "WEEKLY" ? (locale === "de" ? "Wöchentlich" : "Weekly") : uiText(locale, "Monthly", "Monatlich")}</option>)}
            </select>
            {category === "BILLING_SUMMARY" && <span className="mt-1 block font-normal text-gray-500">{locale === "de" ? "Nur für Eigentümer und Administratoren" : "Owners and admins only"}</span>}
          </label>;
        })}
      </div>
    </div>)}
  </div>;
}
