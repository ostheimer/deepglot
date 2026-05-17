"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Edit2, Plus, Search, Trash2 } from "lucide-react";

import { useLocale } from "@/components/providers/locale-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ExclusionType } from "@/lib/exclusions";
import { uiText } from "@/lib/static-copy";

type Exclusion = {
  id: string;
  type: ExclusionType;
  value: string;
  createdAt: string | Date;
};

type ExclusionsManagerProps = {
  projectId: string;
  exclusions: Exclusion[];
};

type FormState = {
  id?: string;
  type: ExclusionType;
  value: string;
};

const EMPTY_FORM: FormState = {
  type: "URL",
  value: "",
};

const TYPE_OPTIONS: ExclusionType[] = ["URL", "REGEX", "CSS_CLASS", "CSS_ID"];

export function ExclusionsManager({
  projectId,
  exclusions: initialExclusions,
}: ExclusionsManagerProps) {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [exclusions, setExclusions] = useState(initialExclusions);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | ExclusionType>("ALL");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Exclusion | null>(null);

  const copy = useMemo(
    () => ({
      title: uiText(locale, "Exclusions", "Ausnahmen"),
      description:
        uiText(locale, "Choose which URLs or HTML blocks are not translated. The WordPress plugin syncs these rules automatically.", "Lege fest, welche URLs oder HTML-Blöcke nicht übersetzt werden. Die WordPress-Erweiterung synchronisiert diese Regeln automatisch."),
      add: uiText(locale, "Add rule", "Regel hinzufügen"),
      edit: uiText(locale, "Edit rule", "Regel bearbeiten"),
      search: uiText(locale, "Search exclusions...", "Ausnahmen suchen..."),
      allTypes: uiText(locale, "All types", "Alle Typen"),
      type: uiText(locale, "Type", "Typ"),
      value: uiText(locale, "Value", "Wert"),
      behavior: uiText(locale, "Behavior", "Verhalten"),
      created: uiText(locale, "Created", "Erstellt"),
      actions: uiText(locale, "Actions", "Aktionen"),
      save: uiText(locale, "Save", "Speichern"),
      cancel: uiText(locale, "Cancel", "Abbrechen"),
      delete: uiText(locale, "Delete", "Löschen"),
      deleteTitle:
        uiText(locale, "Delete exclusion rule?", "Ausnahmeregel löschen?"),
      deleteDescription:
        uiText(locale, "This rule will be removed from the dashboard and no longer applied after the next plugin sync.", "Diese Regel wird aus dem Dashboard entfernt und beim nächsten Plugin-Sync nicht mehr angewendet."),
      empty:
        uiText(locale, "No exclusion rules yet.", "Noch keine Ausnahmeregeln vorhanden."),
      noResults:
        uiText(locale, "No exclusions match the current search.", "Keine Ausnahmen passen zur Suche."),
      valueHint:
        uiText(locale, "CSS classes and IDs can be entered with or without . or #.", "CSS-Klassen und IDs können mit oder ohne . beziehungsweise # eingegeben werden."),
      saved:
        uiText(locale, "Exclusion rule saved", "Ausnahmeregel gespeichert"),
      removed:
        uiText(locale, "Exclusion rule deleted", "Ausnahmeregel gelöscht"),
      saveFailed:
        uiText(locale, "Could not save exclusion rule", "Ausnahmeregel konnte nicht gespeichert werden"),
      deleteFailed:
        uiText(locale, "Could not delete exclusion rule", "Ausnahmeregel konnte nicht gelöscht werden"),
    }),
    [locale]
  );

  const typeLabels = useMemo(
    () => ({
      URL: uiText(locale, "URL contains", "URL enthält"),
      REGEX: uiText(locale, "Regex", "Regex"),
      CSS_CLASS: uiText(locale, "CSS class", "CSS-Klasse"),
      CSS_ID: uiText(locale, "CSS ID", "CSS-ID"),
    }),
    [locale]
  );

  const behaviorLabels = useMemo(
    () => ({
      URL:
        uiText(locale, "The translated route is skipped.", "Die übersetzte Route wird übersprungen."),
      REGEX:
        uiText(locale, "The translated route is skipped by regex.", "Die übersetzte Route wird per Regex übersprungen."),
      CSS_CLASS:
        uiText(locale, "Text inside elements with this class stays unchanged.", "Text in Elementen mit dieser Klasse bleibt unverändert."),
      CSS_ID:
        uiText(locale, "Text inside the element with this ID stays unchanged.", "Text im Element mit dieser ID bleibt unverändert."),
    }),
    [locale]
  );

  const filteredExclusions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return exclusions.filter((exclusion) => {
      const matchesType =
        typeFilter === "ALL" ? true : exclusion.type === typeFilter;
      const matchesQuery =
        normalizedQuery === "" ||
        exclusion.value.toLowerCase().includes(normalizedQuery) ||
        typeLabels[exclusion.type].toLowerCase().includes(normalizedQuery);

      return matchesType && matchesQuery;
    });
  }, [exclusions, query, typeFilter, typeLabels]);

  function resetDialog(nextOpen: boolean) {
    if (!nextOpen) {
      setForm(EMPTY_FORM);
    }

    setDialogOpen(nextOpen);
  }

  function openCreateDialog() {
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEditDialog(exclusion: Exclusion) {
    setForm({
      id: exclusion.id,
      type: exclusion.type,
      value: exclusion.value,
    });
    setDialogOpen(true);
  }

  async function submitForm() {
    const endpoint = form.id
      ? `/api/projects/${projectId}/exclusions/${form.id}`
      : `/api/projects/${projectId}/exclusions`;
    const method = form.id ? "PATCH" : "POST";

    startTransition(async () => {
      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: form.type,
          value: form.value,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        exclusion?: Exclusion;
      };

      if (!response.ok || !data.exclusion) {
        toast.error(data.error ?? copy.saveFailed);
        return;
      }

      setExclusions((current) => {
        const withoutCurrent = current.filter(
          (item) => item.id !== data.exclusion?.id
        );
        return [data.exclusion!, ...withoutCurrent];
      });
      resetDialog(false);
      router.refresh();
      toast.success(copy.saved);
    });
  }

  async function deleteExclusion() {
    if (!deleteTarget) {
      return;
    }

    const target = deleteTarget;

    startTransition(async () => {
      const response = await fetch(
        `/api/projects/${projectId}/exclusions/${target.id}`,
        {
          method: "DELETE",
        }
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        toast.error(data.error ?? copy.deleteFailed);
        return;
      }

      setExclusions((current) => current.filter((item) => item.id !== target.id));
      setDeleteTarget(null);
      router.refresh();
      toast.success(copy.removed);
    });
  }

  function formatValue(exclusion: Exclusion) {
    if (exclusion.type === "CSS_CLASS") {
      return `.${exclusion.value}`;
    }

    if (exclusion.type === "CSS_ID") {
      return `#${exclusion.value}`;
    }

    return exclusion.value;
  }

  const hasRules = exclusions.length > 0;
  const isFormValid = form.value.trim().length > 0;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{copy.title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            {copy.description}
          </p>
        </div>
        <Button
          type="button"
          className="bg-indigo-600 hover:bg-indigo-700"
          onClick={openCreateDialog}
        >
          <Plus className="mr-2 h-4 w-4" />
          {copy.add}
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.search}
              className="pl-9"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(event.target.value as "ALL" | ExclusionType)
            }
            className="flex h-9 rounded-md border border-input bg-white px-3 py-1 text-sm"
          >
            <option value="ALL">{copy.allTypes}</option>
            {TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {typeLabels[type]}
              </option>
            ))}
          </select>
        </div>

        {filteredExclusions.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-gray-500">
              {hasRules ? copy.noResults : copy.empty}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.type}</TableHead>
                <TableHead>{copy.value}</TableHead>
                <TableHead>{copy.behavior}</TableHead>
                <TableHead>{copy.created}</TableHead>
                <TableHead className="text-right">{copy.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredExclusions.map((exclusion) => (
                <TableRow key={exclusion.id}>
                  <TableCell>
                    <Badge variant="secondary">{typeLabels[exclusion.type]}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-gray-900">
                    {formatValue(exclusion)}
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal text-sm text-gray-500">
                    {behaviorLabels[exclusion.type]}
                  </TableCell>
                  <TableCell className="text-sm text-gray-500">
                    {new Date(exclusion.createdAt).toLocaleDateString(
                      locale === "de" ? "de-AT" : "en-US"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(exclusion)}
                      >
                        <Edit2 className="h-4 w-4" />
                        <span className="sr-only">{copy.edit}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(exclusion)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                        <span className="sr-only">{copy.delete}</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={resetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? copy.edit : copy.add}</DialogTitle>
            <DialogDescription>{copy.valueHint}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="exclusion-type">{copy.type}</Label>
              <select
                id="exclusion-type"
                value={form.type}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    type: event.target.value as ExclusionType,
                  }))
                }
                className="flex h-9 rounded-md border border-input bg-white px-3 py-1 text-sm"
              >
                {TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {typeLabels[type]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="exclusion-value">{copy.value}</Label>
              <Input
                id="exclusion-value"
                value={form.value}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    value: event.target.value,
                  }))
                }
                placeholder={
                  form.type === "URL"
                    ? "/kontakt"
                    : form.type === "REGEX"
                      ? "^/checkout"
                      : form.type === "CSS_CLASS"
                        ? ".no-translate"
                        : "#hero"
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => resetDialog(false)}
            >
              {copy.cancel}
            </Button>
            <Button
              type="button"
              className="bg-indigo-600 hover:bg-indigo-700"
              onClick={() => void submitForm()}
              disabled={isPending || !isFormValid}
            >
              {copy.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.deleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void deleteExclusion()}
              disabled={isPending}
            >
              {copy.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
