"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, X } from "lucide-react";
import { useLocale } from "@/components/providers/locale-provider";
import { getLanguageName } from "@/lib/language-names";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const ALL_LANGUAGE_CODES = [
  "en", "fr", "es", "it", "nl", "pl", "pt", "ru", "zh", "ja",
  "ar", "tr", "sv", "da", "fi", "no", "cs", "hu", "ro", "sk",
] as const;

interface AddLanguageDialogProps {
  projectId: string;
  originalLang: string;
  existingLangs: string[];
}

export function AddLanguageDialog({
  projectId,
  originalLang,
  existingLangs,
}: AddLanguageDialogProps) {
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const available = ALL_LANGUAGE_CODES.filter(
    (code) => code !== originalLang && !existingLangs.includes(code)
  );

  async function handleAdd() {
    if (selected.length === 0) return;
    setIsLoading(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/languages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ languages: selected }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? (locale === "de" ? "Fehler beim Hinzufügen" : "Could not add languages"));
        return;
      }

      toast.success(
        locale === "de"
          ? `${selected.length} Sprache${selected.length > 1 ? "n" : ""} hinzugefügt`
          : `${selected.length} language${selected.length > 1 ? "s" : ""} added`
      );
      setOpen(false);
      setSelected([]);
      router.refresh();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-indigo-600 hover:bg-indigo-700" size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {locale === "de" ? "Sprache hinzufügen" : "Add language"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{locale === "de" ? "Übersetzungssprachen hinzufügen" : "Add translation languages"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {locale === "de"
              ? "Wähle die Sprachen, in die du deine Website übersetzen möchtest."
              : "Choose the languages you want to translate your website into."}
          </p>
          {available.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">
              {locale === "de"
                ? "Alle verfügbaren Sprachen sind bereits hinzugefügt."
                : "All available languages have already been added."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {available.map((code) => {
                const isSelected = selected.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() =>
                      setSelected((prev) =>
                        isSelected
                          ? prev.filter((c) => c !== code)
                          : [...prev, code]
                      )
                    }
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      isSelected
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-700 border-gray-300 hover:border-indigo-400"
                    }`}
                  >
                    {isSelected && <X className="h-3 w-3" />}
                    {getLanguageName(code, locale)}
                    <span className="text-xs opacity-70 uppercase">{code}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {locale === "de" ? "Abbrechen" : "Cancel"}
            </Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700"
              onClick={handleAdd}
              disabled={selected.length === 0 || isLoading}
            >
              {isLoading
                ? locale === "de"
                  ? "Wird hinzugefügt..."
                  : "Adding..."
                : locale === "de"
                  ? `${selected.length > 0 ? selected.length + " " : ""}Sprache${selected.length !== 1 ? "n" : ""} hinzufügen`
                  : `Add ${selected.length > 0 ? `${selected.length} ` : ""}language${selected.length !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
