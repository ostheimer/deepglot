"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Globe, X, Plus } from "lucide-react";

const POPULAR_LANGUAGES = [
  { code: "en", name: "Englisch" },
  { code: "fr", name: "Französisch" },
  { code: "es", name: "Spanisch" },
  { code: "it", name: "Italienisch" },
  { code: "nl", name: "Niederländisch" },
  { code: "pl", name: "Polnisch" },
  { code: "pt", name: "Portugiesisch" },
  { code: "ru", name: "Russisch" },
  { code: "zh", name: "Chinesisch" },
  { code: "ja", name: "Japanisch" },
  { code: "ar", name: "Arabisch" },
  { code: "tr", name: "Türkisch" },
];

export default function NeuesProjektPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [originalLang, setOriginalLang] = useState("de");
  const [selectedLangs, setSelectedLangs] = useState<string[]>(["en"]);

  function toggleLanguage(code: string) {
    setSelectedLangs((prev) =>
      prev.includes(code) ? prev.filter((l) => l !== code) : [...prev, code]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedLangs.length === 0) {
      toast.error("Wähle mindestens eine Übersetzungssprache");
      return;
    }
    setIsLoading(true);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, domain, originalLang, languages: selectedLangs }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Projekt konnte nicht erstellt werden");
        return;
      }

      toast.success("Projekt erfolgreich erstellt");
      router.push(`/projekte/${data.projectId}/uebersetzungen/sprachen`);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Neues Projekt</h1>
        <p className="text-gray-600 mt-1">
          Verbinde deine Website mit Deepglot und starte die Übersetzung.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-indigo-600" />
              Website-Informationen
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Projektname</Label>
              <Input
                id="name"
                placeholder="z.B. Meine Unternehmenswebsite"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="domain">Domain</Label>
              <Input
                id="domain"
                placeholder="z.B. example.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value.replace(/^https?:\/\//, ""))}
                required
              />
              <p className="text-xs text-gray-500">
                Ohne https:// – z.B. example.com oder sub.example.com
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sprachen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Originalsprache der Website</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={originalLang}
                onChange={(e) => setOriginalLang(e.target.value)}
              >
                <option value="de">Deutsch</option>
                <option value="en">Englisch</option>
                <option value="fr">Französisch</option>
                <option value="es">Spanisch</option>
                <option value="it">Italienisch</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Übersetzungssprachen</Label>
              <p className="text-xs text-gray-500">
                Wähle die Sprachen, in die du übersetzen möchtest.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {POPULAR_LANGUAGES.filter((l) => l.code !== originalLang).map(
                  (lang) => {
                    const isSelected = selectedLangs.includes(lang.code);
                    return (
                      <button
                        key={lang.code}
                        type="button"
                        onClick={() => toggleLanguage(lang.code)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                          isSelected
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-white text-gray-700 border-gray-300 hover:border-indigo-400"
                        }`}
                      >
                        {isSelected && <X className="h-3 w-3" />}
                        {!isSelected && <Plus className="h-3 w-3" />}
                        {lang.name}
                        <span className="opacity-70 text-xs uppercase">
                          {lang.code}
                        </span>
                      </button>
                    );
                  }
                )}
              </div>
              {selectedLangs.length > 0 && (
                <p className="text-xs text-indigo-600 mt-2">
                  {selectedLangs.length} Sprache{selectedLangs.length > 1 ? "n" : ""} ausgewählt:{" "}
                  {selectedLangs.map((c) => c.toUpperCase()).join(", ")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isLoading}
          >
            Abbrechen
          </Button>
          <Button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-700"
            disabled={isLoading}
          >
            {isLoading ? "Wird erstellt..." : "Projekt erstellen"}
          </Button>
        </div>
      </form>
    </div>
  );
}
