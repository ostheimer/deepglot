"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SiteLocale } from "@/lib/site-locale";

type Slug = {
  id: string;
  originalSlug: string;
  translatedSlug: string | null;
  updatedAt: string;
};

// New dashboard copy uses English as the documented fallback for other locales.
const errors: Record<string, { de: string; fallback: string }> = {
  invalid_slug: { de: "Bitte einen gültigen einzelnen Slug eingeben.", fallback: "Enter a valid single slug." },
  reserved_slug: { de: "Dieser WordPress-Pfad ist reserviert.", fallback: "This WordPress path is reserved." },
  slug_collision: { de: "Dieser Slug ist bereits vergeben oder ein Originalpfad.", fallback: "This slug is already used or is an original path." },
  stale_slug: { de: "Der Slug wurde inzwischen geändert. Bitte neu laden.", fallback: "This slug changed meanwhile. Reload the page." },
  concurrent_change: { de: "Gleichzeitige Änderung. Bitte erneut versuchen.", fallback: "Concurrent change. Please try again." },
  inactive_language: { de: "Diese Zielsprache ist nicht mehr aktiv.", fallback: "This target language is no longer active." },
};

export function SlugRowEditor({ projectId, initialSlug, locale }: {
  projectId: string;
  initialSlug: Slug;
  locale: SiteLocale;
}) {
  const router = useRouter();
  const de = locale === "de";
  const [slug, setSlug] = useState(initialSlug);
  const [draft, setDraft] = useState(slug.translatedSlug ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save(value: string | null) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/slugs/${encodeURIComponent(slug.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ translatedSlug: value, updatedAt: slug.updatedAt }),
      });
      const result = await response.json();
      if (!response.ok) {
        const known = Object.hasOwn(errors, result.code) ? errors[result.code] : undefined;
        setMessage(known ? (de ? known.de : known.fallback) : (de ? "Speichern fehlgeschlagen." : "Could not save."));
        return;
      }
      setSlug({ ...slug, translatedSlug: result.slug.translatedSlug, updatedAt: result.slug.updatedAt });
      setDraft(result.slug.translatedSlug ?? "");
      setEditing(false);
      setMessage(de ? "Gespeichert. Die Änderung wird beim nächsten Abgleich des WordPress-Plugins aktiv." : "Saved. The change becomes active after the next WordPress plugin sync.");
      router.refresh();
    } catch {
      setMessage(de ? "Speichern fehlgeschlagen." : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0">
      {editing ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void save(draft); }}>
          <Input aria-label={de ? `Übersetzter Slug für ${slug.originalSlug}` : `Translated slug for ${slug.originalSlug}`} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={saving} className="h-9 min-w-44 flex-1" />
          <Button type="submit" size="sm" disabled={saving}>{de ? "Speichern" : "Save"}</Button>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => { setDraft(slug.translatedSlug ?? ""); setEditing(false); setMessage(""); }}>{de ? "Abbrechen" : "Cancel"}</Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {slug.translatedSlug ? <span className="min-w-0 break-all text-sm font-medium text-gray-900">{slug.translatedSlug}</span> : <span className="text-sm text-gray-400">{de ? "Kein Mapping" : "No mapping"}</span>}
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => { setEditing(true); setMessage(""); }}>{de ? "Bearbeiten" : "Edit"}</Button>
          {slug.translatedSlug && <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void save(null)}>{de ? "Zurücksetzen" : "Reset"}</Button>}
        </div>
      )}
      {message && <p role="status" className="mt-1 text-xs text-gray-600">{message}</p>}
    </div>
  );
}
