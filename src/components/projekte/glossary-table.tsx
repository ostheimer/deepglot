"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Edit2, Plus, Trash2, Upload } from "lucide-react";

import { useLocale } from "@/components/providers/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getLanguageName } from "@/lib/language-names";

interface GlossaryRule {
  id: string;
  originalTerm: string;
  translatedTerm: string;
  langFrom: string;
  langTo: string;
  caseSensitive: boolean;
}

interface GlossaryTableProps {
  rules: GlossaryRule[];
  projectId: string;
  languages: { id: string; langCode: string }[];
  originalLang: string;
}

type GlossaryFormState = {
  id?: string;
  originalTerm: string;
  translatedTerm: string;
  langFrom: string;
  langTo: string;
  caseSensitive: boolean;
};

const EMPTY_FORM: GlossaryFormState = {
  originalTerm: "",
  translatedTerm: "",
  langFrom: "de",
  langTo: "en",
  caseSensitive: false,
};

export function GlossaryTable({
  rules: initialRules,
  projectId,
  languages,
  originalLang,
}: GlossaryTableProps) {
  const locale = useLocale();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [rules, setRules] = useState(initialRules);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<GlossaryFormState>({
    ...EMPTY_FORM,
    langFrom: originalLang,
    langTo: languages[0]?.langCode ?? "en",
  });

  const allLanguages = useMemo(
    () =>
      Array.from(
        new Set([originalLang, ...languages.map((language) => language.langCode)])
      ),
    [languages, originalLang]
  );

  const copy = {
    title: locale === "de" ? "Glossar" : "Glossary",
    addRule: locale === "de" ? "Glossarregel hinzufügen" : "Add glossary rule",
    editRule: locale === "de" ? "Glossarregel bearbeiten" : "Edit glossary rule",
    importFile: locale === "de" ? "Datei importieren" : "Import file",
    exportFile: locale === "de" ? "CSV exportieren" : "Export CSV",
    save: locale === "de" ? "Speichern" : "Save",
    cancel: locale === "de" ? "Abbrechen" : "Cancel",
    originalTerm: locale === "de" ? "Originalbegriff" : "Original term",
    translatedTerm:
      locale === "de" ? "Übersetzter Begriff" : "Translated term",
    sourceLanguage: locale === "de" ? "Ausgangssprache" : "Source language",
    targetLanguage: locale === "de" ? "Zielsprache" : "Target language",
    caseSensitive:
      locale === "de"
        ? "Groß-/Kleinschreibung beachten"
        : "Match case-sensitively",
    neverTranslate:
      locale === "de"
        ? "Nicht übersetzen"
        : "Never translate this term",
    empty:
      locale === "de"
        ? "Noch keine Glossarregeln vorhanden."
        : "No glossary rules yet.",
    description:
      locale === "de"
        ? "Glossarregeln werden vor der Provider-Übersetzung geschützt. Manuelle Übersetzungen haben weiterhin Vorrang."
        : "Glossary rules are protected before provider translation. Manual translations still take precedence.",
  };

  function resetForm(nextOpen: boolean) {
    if (!nextOpen) {
      setForm({
        ...EMPTY_FORM,
        langFrom: originalLang,
        langTo: languages[0]?.langCode ?? "en",
      });
    }
    setOpen(nextOpen);
  }

  function openCreateDialog() {
    setForm({
      ...EMPTY_FORM,
      langFrom: originalLang,
      langTo: languages[0]?.langCode ?? "en",
    });
    setOpen(true);
  }

  function openEditDialog(rule: GlossaryRule) {
    setForm({
      id: rule.id,
      originalTerm: rule.originalTerm,
      translatedTerm: rule.translatedTerm,
      langFrom: rule.langFrom,
      langTo: rule.langTo,
      caseSensitive: rule.caseSensitive,
    });
    setOpen(true);
  }

  function updateForm<K extends keyof GlossaryFormState>(
    key: K,
    value: GlossaryFormState[K]
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handleSubmit() {
    const endpoint = form.id
      ? `/api/projects/${projectId}/glossary/${form.id}`
      : `/api/projects/${projectId}/glossary`;
    const method = form.id ? "PATCH" : "POST";

    startTransition(async () => {
      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          originalTerm: form.originalTerm,
          translatedTerm: form.translatedTerm,
          langFrom: form.langFrom,
          langTo: form.langTo,
          caseSensitive: form.caseSensitive,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        rule?: GlossaryRule;
      };

      if (!response.ok || !data.rule) {
        toast.error(
          data.error ??
            (locale === "de"
              ? "Glossarregel konnte nicht gespeichert werden"
              : "Could not save glossary rule")
        );
        return;
      }

      setRules((current) => {
        const withoutCurrent = current.filter((rule) => rule.id !== data.rule?.id);
        return [data.rule!, ...withoutCurrent];
      });
      resetForm(false);
      router.refresh();
      toast.success(
        locale === "de"
          ? "Glossarregel gespeichert"
          : "Glossary rule saved"
      );
    });
  }

  async function handleDelete(rule: GlossaryRule) {
    const confirmed = window.confirm(
      locale === "de"
        ? `Glossarregel „${rule.originalTerm}“ löschen?`
        : `Delete glossary rule "${rule.originalTerm}"?`
    );

    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      const response = await fetch(`/api/projects/${projectId}/glossary/${rule.id}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        toast.error(
          data.error ??
            (locale === "de"
              ? "Glossarregel konnte nicht gelöscht werden"
              : "Could not delete glossary rule")
        );
        return;
      }

      setRules((current) => current.filter((item) => item.id !== rule.id));
      router.refresh();
      toast.success(
        locale === "de"
          ? "Glossarregel gelöscht"
          : "Glossary rule deleted"
      );
    });
  }

  async function handleImport(file: File) {
    const body = new FormData();
    body.set("asset", "glossary");
    body.set("format", "csv");
    body.set("file", file);

    startTransition(async () => {
      const response = await fetch(`/api/projects/${projectId}/import`, {
        method: "POST",
        body,
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        importedRows?: number;
      };

      if (!response.ok) {
        toast.error(
          data.error ??
            (locale === "de"
              ? "Glossar konnte nicht importiert werden"
              : "Could not import glossary")
        );
        return;
      }

      toast.success(
        locale === "de"
          ? `${data.importedRows ?? 0} Glossarregeln importiert`
          : `Imported ${data.importedRows ?? 0} glossary rules`
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{copy.title}</h2>
          <p className="mt-1 text-sm text-gray-500">{copy.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleImport(file);
              }
              event.currentTarget.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            {copy.importFile}
          </Button>
          <Button asChild variant="outline" size="sm">
            <a
              href={`/api/projects/${projectId}/export?asset=glossary&format=csv`}
            >
              {copy.exportFile}
            </a>
          </Button>
          <Button
            type="button"
            className="bg-indigo-600 hover:bg-indigo-700"
            size="sm"
            onClick={openCreateDialog}
          >
            <Plus className="mr-2 h-4 w-4" />
            {copy.addRule}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="grid grid-cols-[2fr_2fr_1fr_auto] gap-4 border-b border-gray-200 bg-gray-50 px-6 py-3">
          <span className="text-xs font-semibold tracking-wider text-gray-500 uppercase">
            Original
          </span>
          <span className="text-xs font-semibold tracking-wider text-gray-500 uppercase">
            {locale === "de" ? "Übersetzung" : "Translation"}
          </span>
          <span className="text-xs font-semibold tracking-wider text-gray-500 uppercase">
            {locale === "de" ? "Sprache" : "Language"}
          </span>
          <span />
        </div>

        {rules.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-gray-500">
            {copy.empty}
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className="grid grid-cols-[2fr_2fr_1fr_auto] items-center gap-4 border-b border-gray-100 px-6 py-3.5 last:border-0 hover:bg-gray-50"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {rule.originalTerm}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {rule.caseSensitive && (
                    <Badge variant="outline" className="text-xs">
                      {locale === "de"
                        ? "Groß-/Kleinschreibung"
                        : "Case-sensitive"}
                    </Badge>
                  )}
                  {rule.originalTerm === rule.translatedTerm && (
                    <Badge variant="secondary" className="text-xs">
                      {copy.neverTranslate}
                    </Badge>
                  )}
                </div>
              </div>
              <p className="text-sm text-gray-700">{rule.translatedTerm}</p>
              <Badge variant="secondary" className="w-fit text-xs">
                {getLanguageName(rule.langFrom, locale)} →{" "}
                {getLanguageName(rule.langTo, locale)}
              </Badge>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => openEditDialog(rule)}
                >
                  <Edit2 className="h-3.5 w-3.5 text-gray-500" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => void handleDelete(rule)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-gray-500 hover:text-red-500" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={open} onOpenChange={resetForm}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{form.id ? copy.editRule : copy.addRule}</DialogTitle>
            <DialogDescription>
              {locale === "de"
                ? "Verwende denselben Zielbegriff wie den Originalbegriff, um einen Ausdruck nie zu übersetzen."
                : "Use the same target term as the original term to keep a phrase untranslated."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="glossary-original">{copy.originalTerm}</Label>
              <Input
                id="glossary-original"
                value={form.originalTerm}
                onChange={(event) => updateForm("originalTerm", event.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="glossary-translation">{copy.translatedTerm}</Label>
              <Input
                id="glossary-translation"
                value={form.translatedTerm}
                onChange={(event) =>
                  updateForm("translatedTerm", event.target.value)
                }
              />
              <button
                type="button"
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                onClick={() => updateForm("translatedTerm", form.originalTerm)}
              >
                {copy.neverTranslate}
              </button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="glossary-lang-from">{copy.sourceLanguage}</Label>
              <select
                id="glossary-lang-from"
                value={form.langFrom}
                onChange={(event) => updateForm("langFrom", event.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm"
              >
                {allLanguages.map((language) => (
                  <option key={language} value={language}>
                    {getLanguageName(language, locale)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="glossary-lang-to">{copy.targetLanguage}</Label>
              <select
                id="glossary-lang-to"
                value={form.langTo}
                onChange={(event) => updateForm("langTo", event.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm"
              >
                {languages.map((language) => (
                  <option key={language.id} value={language.langCode}>
                    {getLanguageName(language.langCode, locale)}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.caseSensitive}
                onChange={(event) =>
                  updateForm("caseSensitive", event.target.checked)
                }
                className="h-4 w-4 rounded border-gray-300 text-indigo-600"
              />
              <span className="text-sm text-gray-700">{copy.caseSensitive}</span>
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => resetForm(false)}>
              {copy.cancel}
            </Button>
            <Button
              type="button"
              className="bg-indigo-600 hover:bg-indigo-700"
              disabled={
                isPending ||
                !form.originalTerm.trim() ||
                !form.translatedTerm.trim()
              }
              onClick={() => void handleSubmit()}
            >
              {copy.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
