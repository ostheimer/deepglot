"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { uiText } from "@/lib/static-copy";
import type { SiteLocale } from "@/lib/site-locale";
import {
  detectTranslationVariables,
  type TranslationMetadataValue,
} from "@/lib/translation-metadata";

export function TranslationMetadataPanel({
  projectId,
  translationId,
  originalText,
  metadata,
  canEdit,
  locale,
  onSaved,
}: {
  projectId: string;
  translationId: string;
  originalText: string;
  metadata?: TranslationMetadataValue | null;
  canEdit: boolean;
  locale: SiteLocale;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<TranslationMetadataValue | null>(null);
  const [labels, setLabels] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const suggestions = [
    ...new Set([
      ...detectTranslationVariables(originalText),
      ...(draft?.variables ?? []),
    ]),
  ];
  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/translations/${translationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadata: {
              labels: labels
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
              variables: draft.variables,
              note: draft.note,
            },
            expectedVersion: draft.version,
          }),
        },
      );
      if (!response.ok) throw new Error("Metadata save failed");
      setDraft(null);
      await onSaved();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <details className="rounded-md border border-gray-200 p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {uiText(locale, "Labels and variables", "Labels und Variablen")}
      </summary>
      {draft && canEdit ? (
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="block">
            {uiText(
              locale,
              "Labels (one per line)",
              "Labels (eines pro Zeile)",
            )}
            <textarea
              className="mt-1 block w-full rounded-md border p-2"
              rows={2}
              maxLength={1000}
              disabled={saving}
              value={labels}
              onChange={(event) => setLabels(event.target.value)}
            />
          </label>
          <label className="block">
            {uiText(locale, "Notes", "Notizen")}
            <textarea
              className="mt-1 block w-full rounded-md border p-2"
              rows={2}
              maxLength={2000}
              disabled={saving}
              value={draft.note}
              onChange={(event) =>
                setDraft({ ...draft, note: event.target.value })
              }
            />
          </label>
          <fieldset disabled={saving} className="space-y-2">
            <legend>
              {uiText(locale, "Detected placeholders", "Erkannte Platzhalter")}
            </legend>
            {suggestions.length ? (
              suggestions.map((token) => (
                <label
                  key={token}
                  className="flex items-center gap-2 break-all"
                >
                  <input
                    type="checkbox"
                    checked={draft.variables.includes(token)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        variables: event.target.checked
                          ? [...draft.variables, token]
                          : draft.variables.filter((value) => value !== token),
                      })
                    }
                  />
                  <code>{token}</code>
                </label>
              ))
            ) : (
              <p className="text-gray-500">
                {uiText(
                  locale,
                  "No supported placeholders detected.",
                  "Keine unterstützten Platzhalter erkannt.",
                )}
              </p>
            )}
          </fieldset>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {uiText(locale, "Save", "Speichern")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setDraft(null);
                setError(false);
              }}
            >
              {uiText(locale, "Cancel", "Abbrechen")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="break-words">
            {uiText(
              locale,
              "Labels (one per line)",
              "Labels (eines pro Zeile)",
            )}
            : {metadata?.labels.join(", ") || "—"}
          </p>
          <p className="whitespace-pre-wrap break-words">
            {uiText(locale, "Notes", "Notizen")}: {metadata?.note || "—"}
          </p>
          <p className="break-all">
            {uiText(locale, "Saved variables", "Gespeicherte Variablen")}:{" "}
            {metadata?.variables.join(", ") || "—"}
          </p>
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(
                  metadata ?? {
                    labels: [],
                    variables: [],
                    note: "",
                    version: 0,
                  },
                );
                setLabels(metadata?.labels.join("\n") ?? "");
                setError(false);
              }}
            >
              {uiText(locale, "Edit metadata", "Metadaten bearbeiten")}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-red-700">
          {uiText(
            locale,
            "The workflow change could not be saved. Reload and try again.",
            "Die Workflow-Änderung konnte nicht gespeichert werden. Lade neu und versuche es erneut.",
          )}
        </p>
      )}
    </details>
  );
}
