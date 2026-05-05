"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";

import { useLocale } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { getLanguageName } from "@/lib/language-names";

type ImportConfig = {
  asset: "translations" | "glossary" | "slugs";
  format: "csv" | "po";
  langTo?: string;
};

type ImportExportPanelProps = {
  projectId: string;
  originalLang: string;
  languages: Array<{ id: string; langCode: string }>;
};

export function ImportExportPanel({
  projectId,
  originalLang,
  languages,
}: ImportExportPanelProps) {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [poLanguage, setPoLanguage] = useState(languages[0]?.langCode ?? "");
  const pendingImportRef = useRef<ImportConfig | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasPoLanguages = languages.length > 0;
  const poLanguageSelectId = "po-target-language";

  const copy = {
    title: locale === "de" ? "Import & Export" : "Import & export",
    description:
      locale === "de"
        ? "CSV deckt Übersetzungen, Glossarregeln und URL-Slugs ab. PO-Dateien unterstützen Übersetzungen pro Zielsprache."
        : "CSV covers translations, glossary rules, and URL slugs. PO files support translations per target language.",
    import: locale === "de" ? "Importieren" : "Import",
    export: locale === "de" ? "Exportieren" : "Export",
    translations:
      locale === "de" ? "Übersetzungen" : "Translations",
    glossary: locale === "de" ? "Glossarregeln" : "Glossary rules",
    slugs: locale === "de" ? "URL-Slugs" : "URL slugs",
    chooseLanguage:
      locale === "de" ? "Zielsprache für PO" : "Target language for PO",
    importSuccess:
      locale === "de" ? "Import erfolgreich abgeschlossen" : "Import finished successfully",
    csvHint:
      locale === "de"
        ? "CSV mit festen englischen Spaltenüberschriften."
        : "CSV with fixed English column headers.",
    poHint:
      locale === "de"
        ? `PO-Dateien immer pro Zielsprache. Ausgangssprache: ${getLanguageName(originalLang, locale)}.`
        : `PO files are always per target language. Source language: ${getLanguageName(originalLang, locale)}.`,
    noPoLanguages:
      locale === "de"
        ? "Füge zuerst eine aktive Zielsprache hinzu, bevor du PO-Dateien importierst oder exportierst."
        : "Add an active target language before importing or exporting PO files.",
  };

  function openImport(config: ImportConfig) {
    pendingImportRef.current = config;
    fileInputRef.current?.click();
  }

  function buildExportHref(config: ImportConfig) {
    const params = new URLSearchParams({
      asset: config.asset,
      format: config.format,
    });

    if (config.langTo) {
      params.set("langTo", config.langTo);
    }

    return `/api/projects/${projectId}/export?${params.toString()}`;
  }

  async function handleFileSelected(file: File) {
    const config = pendingImportRef.current;

    if (!config) {
      return;
    }

    const formData = new FormData();
    formData.set("asset", config.asset);
    formData.set("format", config.format);
    formData.set("file", file);

    if (config.langTo) {
      formData.set("langTo", config.langTo);
    }

    startTransition(async () => {
      const response = await fetch(`/api/projects/${projectId}/import`, {
        method: "POST",
        body: formData,
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        importedRows?: number;
      };

      if (!response.ok) {
        toast.error(
          data.error ??
            (locale === "de" ? "Import fehlgeschlagen" : "Import failed")
        );
        return;
      }

      toast.success(
        locale === "de"
          ? `${data.importedRows ?? 0} Zeilen importiert`
          : `Imported ${data.importedRows ?? 0} rows`
      );
      router.refresh();
    });
  }

  const cards = [
    {
      title: `${copy.translations} CSV`,
      description:
        locale === "de"
          ? "Importiert oder exportiert alle gespeicherten Übersetzungen als CSV."
          : "Import or export all stored translations as CSV.",
      hint: copy.csvHint,
      asset: "translations" as const,
      format: "csv" as const,
    },
    {
      title: copy.glossary,
      description:
        locale === "de"
          ? "Pflegt Glossarregeln als CSV mit Zeilenvalidierung und Upserts."
          : "Manage glossary rules as CSV with row validation and upserts.",
      hint: copy.csvHint,
      asset: "glossary" as const,
      format: "csv" as const,
    },
    {
      title: copy.slugs,
      description:
        locale === "de"
          ? "Importiert oder exportiert URL-Slugs als CSV."
          : "Import or export URL slugs as CSV.",
      hint: copy.csvHint,
      asset: "slugs" as const,
      format: "csv" as const,
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{copy.title}</h2>
        <p className="mt-1 text-sm text-gray-500">{copy.description}</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.po,text/csv,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handleFileSelected(file);
          }
          event.currentTarget.value = "";
        }}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {cards.map((card) => (
          <section
            key={`${card.asset}-${card.format}`}
            className="rounded-xl border border-gray-200 bg-white p-5"
          >
            <h3 className="text-base font-semibold text-gray-900">{card.title}</h3>
            <p className="mt-1 text-sm text-gray-500">{card.description}</p>
            <p className="mt-3 text-xs text-gray-400">{card.hint}</p>
            <div className="mt-5 flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => openImport(card)}
                disabled={isPending}
              >
                <Upload className="mr-2 h-4 w-4" />
                {copy.import}
              </Button>
              <Button asChild className="bg-indigo-600 hover:bg-indigo-700">
                <a href={buildExportHref(card)}>
                  <Download className="mr-2 h-4 w-4" />
                  {copy.export}
                </a>
              </Button>
            </div>
          </section>
        ))}
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {copy.translations} PO
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {locale === "de"
                ? "PO-Import schreibt manuelle Übersetzungen als autoritative Overrides."
                : "PO import writes manual translations as authoritative overrides."}
            </p>
            <p className="mt-3 text-xs text-gray-400">{copy.poHint}</p>
          </div>
          <div className="w-full max-w-xs space-y-2">
            <label
              htmlFor={poLanguageSelectId}
              className="text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              {copy.chooseLanguage}
            </label>
            <select
              id={poLanguageSelectId}
              value={poLanguage}
              onChange={(event) => setPoLanguage(event.target.value)}
              disabled={!hasPoLanguages}
              className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm"
            >
              {languages.map((language) => (
                <option key={language.id} value={language.langCode}>
                  {getLanguageName(language.langCode, locale)}
                </option>
              ))}
            </select>
            {!hasPoLanguages && (
              <p className="text-xs text-amber-700">{copy.noPoLanguages}</p>
            )}
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              openImport({
                asset: "translations",
                format: "po",
                langTo: poLanguage,
              })
            }
            disabled={isPending || !hasPoLanguages}
          >
            <Upload className="mr-2 h-4 w-4" />
            {copy.import}
          </Button>
          {hasPoLanguages ? (
            <Button asChild className="bg-indigo-600 hover:bg-indigo-700">
              <a
                href={buildExportHref({
                  asset: "translations",
                  format: "po",
                  langTo: poLanguage,
                })}
              >
                <Download className="mr-2 h-4 w-4" />
                {copy.export}
              </a>
            </Button>
          ) : (
            <Button type="button" disabled className="bg-indigo-600 hover:bg-indigo-700">
              <Download className="mr-2 h-4 w-4" />
              {copy.export}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
