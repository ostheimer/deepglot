"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SlugRowEditor } from "@/components/projekte/slug-row-editor";
import { serializeSlugsCsv } from "@/lib/import-export";
import type { SiteLocale } from "@/lib/site-locale";

type Row = { id: string; originalSlug: string; translatedSlug: string | null; updatedAt: string; langTo: string; urlCount: number };

export function SlugList({ rows, projectId, canEdit, locale }: { rows: Row[]; projectId: string; canEdit: boolean; locale: SiteLocale }) {
  const de = locale === "de";
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selectedRows = rows.filter((row) => selected.includes(row.id));

  function exportSelected() {
    const csv = serializeSlugsCsv(selectedRows.map((row) => ({
      originalSlug: row.originalSlug, translatedSlug: row.translatedSlug ?? "", langTo: row.langTo, urlCount: row.urlCount,
    })));
    const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "deepglot-selected-slugs.csv";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async function resetSelected() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/slugs/bulk`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset", rows: selectedRows.map((row) => ({ id: row.id, updatedAt: row.updatedAt })) }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.code === "stale_slug"
          ? (de ? "Mindestens ein Slug wurde inzwischen geändert. Bitte neu laden." : "At least one slug changed. Reload the page.")
          : (de ? "Die Auswahl konnte nicht zurückgesetzt werden." : "Could not reset the selection."));
        return;
      }
      setSelected([]);
      setMessage(de ? `${result.count} Slugs zurückgesetzt. Die Änderung wird beim nächsten Plugin-Abgleich aktiv.` : `${result.count} slugs reset. The change becomes active after the next plugin sync.`);
      router.refresh();
    } catch {
      setMessage(de ? "Die Auswahl konnte nicht zurückgesetzt werden." : "Could not reset the selection.");
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-sm text-gray-600">{de ? `${selected.length} auf dieser Seite ausgewählt` : `${selected.length} selected on this page`}</span>
      <Button type="button" size="sm" variant="outline" disabled={selected.length === 0 || busy} onClick={exportSelected}>{de ? "Auswahl exportieren" : "Export selected"}</Button>
      {canEdit && <Button type="button" size="sm" variant="outline" disabled={!selectedRows.some((row) => row.translatedSlug !== null) || busy} onClick={() => void resetSelected()}>{de ? "Auswahl zurücksetzen" : "Reset selected"}</Button>}
      {message && <span role="status" className="text-sm text-gray-600">{message}</span>}
    </div>
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
        <input type="checkbox" aria-label={de ? "Alle Slugs auf dieser Seite auswählen" : "Select all slugs on this page"} checked={rows.length > 0 && selected.length === rows.length} onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])} />
        <span className="text-xs font-semibold uppercase text-gray-500">{de ? "Original-Slug" : "Original slug"}</span>
        <span className="hidden text-xs font-semibold uppercase text-gray-500 sm:block">{de ? "Übersetzter Slug" : "Translated slug"}</span>
      </div>
      {rows.map((row) => <div key={row.id} data-slug-id={row.id} data-slug-updated-at={row.updatedAt} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-0 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
        <input type="checkbox" aria-label={de ? `${row.originalSlug} auswählen` : `Select ${row.originalSlug}`} checked={selected.includes(row.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} />
        <div className="min-w-0"><p className="break-all text-sm font-medium text-gray-900">{row.originalSlug}</p>{row.urlCount > 0 && <p className="text-xs text-gray-400">{de ? `In ${row.urlCount} URLs gefunden` : `Found in ${row.urlCount} URLs`}</p>}</div>
        <div className="col-start-2 min-w-0 sm:col-start-auto">{canEdit ? <SlugRowEditor projectId={projectId} initialSlug={row} locale={locale} /> : row.translatedSlug ? <p className="break-all text-sm">{row.translatedSlug}</p> : <p className="text-sm text-gray-400">{de ? "Kein Mapping" : "No mapping"}</p>}</div>
      </div>)}
    </div>
  </div>;
}
