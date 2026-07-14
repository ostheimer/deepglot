"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

export function TranslationMemoryToggle({
  projectId,
  locale,
  initialEnabled,
  eligible,
}: {
  projectId: string;
  locale: string;
  initialEnabled: boolean;
  eligible: boolean;
}) {
  const de = locale === "de";
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = de ? "Übersetzungsgedächtnis" : "Translation memory";

  async function update() {
    if (!eligible || saving) return;
    const next = !enabled;
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/translation-memory`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        }
      );
      const payload = (await response.json().catch(() => null)) as
        | { enabled?: boolean; error?: string }
        | null;
      if (!response.ok || typeof payload?.enabled !== "boolean") {
        throw new Error(payload?.error || "Speichern fehlgeschlagen");
      }
      setEnabled(payload.enabled);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : de
            ? "Speichern fehlgeschlagen."
            : "Saving failed."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-x border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">{label}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
            {eligible
              ? de
                ? "Verwendet die neuesten manuell geprüften Übersetzungen aus anderen Projekten derselben Organisation, bevor ein Anbieter aufgerufen wird."
                : "Uses the newest manually reviewed translations from other projects in the same organization before calling a provider."
              : de
                ? "Ab dem Pro-Plan verfügbar."
                : "Available on the Pro plan and above."}
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {de && error === "Speichern fehlgeschlagen"
                ? "Speichern fehlgeschlagen."
                : error}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={label}
          disabled={!eligible || saving}
          onClick={update}
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
            enabled ? "bg-indigo-600" : "bg-gray-200",
            (!eligible || saving) && "cursor-not-allowed opacity-40"
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
    </div>
  );
}
