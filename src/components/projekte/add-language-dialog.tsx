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
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const ALL_LANGUAGES = [
  { code: "en", name: "Englisch" }, { code: "fr", name: "Französisch" },
  { code: "es", name: "Spanisch" }, { code: "it", name: "Italienisch" },
  { code: "nl", name: "Niederländisch" }, { code: "pl", name: "Polnisch" },
  { code: "pt", name: "Portugiesisch" }, { code: "ru", name: "Russisch" },
  { code: "zh", name: "Chinesisch" }, { code: "ja", name: "Japanisch" },
  { code: "ar", name: "Arabisch" }, { code: "tr", name: "Türkisch" },
  { code: "sv", name: "Schwedisch" }, { code: "da", name: "Dänisch" },
  { code: "fi", name: "Finnisch" }, { code: "no", name: "Norwegisch" },
  { code: "cs", name: "Tschechisch" }, { code: "hu", name: "Ungarisch" },
  { code: "ro", name: "Rumänisch" }, { code: "sk", name: "Slowakisch" },
];

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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const available = ALL_LANGUAGES.filter(
    (l) => l.code !== originalLang && !existingLangs.includes(l.code)
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
        toast.error(data.error ?? "Fehler beim Hinzufügen");
        return;
      }

      toast.success(
        `${selected.length} Sprache${selected.length > 1 ? "n" : ""} hinzugefügt`
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
          Sprache hinzufügen
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Übersetzungssprachen hinzufügen</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Wähle die Sprachen, in die du deine Website übersetzen möchtest.
          </p>
          {available.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">
              Alle verfügbaren Sprachen sind bereits hinzugefügt.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {available.map((lang) => {
                const isSelected = selected.includes(lang.code);
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() =>
                      setSelected((prev) =>
                        isSelected
                          ? prev.filter((c) => c !== lang.code)
                          : [...prev, lang.code]
                      )
                    }
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      isSelected
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-700 border-gray-300 hover:border-indigo-400"
                    }`}
                  >
                    {isSelected && <X className="h-3 w-3" />}
                    {lang.name}
                    <span className="text-xs opacity-70 uppercase">{lang.code}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700"
              onClick={handleAdd}
              disabled={selected.length === 0 || isLoading}
            >
              {isLoading
                ? "Wird hinzugefügt..."
                : `${selected.length > 0 ? selected.length + " " : ""}Sprache${selected.length !== 1 ? "n" : ""} hinzufügen`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
