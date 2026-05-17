"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Globe, X, Plus } from "lucide-react";
import { useLocale } from "@/components/providers/locale-provider";
import { getPopularLanguageOptions, getLanguageName } from "@/lib/language-names";
import { withLocalePrefix } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

export default function NeuesProjektPage() {
  const locale = useLocale();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [originalLang, setOriginalLang] = useState("de");
  const [selectedLangs, setSelectedLangs] = useState<string[]>(["en"]);
  const popularLanguages = getPopularLanguageOptions(locale);

  function toggleLanguage(code: string) {
    setSelectedLangs((prev) =>
      prev.includes(code) ? prev.filter((l) => l !== code) : [...prev, code]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedLangs.length === 0) {
      toast.error(
        uiText(locale, "Choose at least one translation language", "Wähle mindestens eine Übersetzungssprache")
      );
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
        toast.error(data.error ?? (uiText(locale, "Could not create project", "Projekt konnte nicht erstellt werden")));
        return;
      }

      // Store the raw API key in sessionStorage so the API Keys page can display
      // it once without exposing it in the URL.
      if (data.rawKey) {
        sessionStorage.setItem(
          `deepglot_new_api_key_${data.projectId}`,
          JSON.stringify({ rawKey: data.rawKey, keyName: data.keyName })
        );
      }

      toast.success(uiText(locale, "Project created successfully", "Projekt erfolgreich erstellt"));
      router.push(withLocalePrefix(`/projects/${data.projectId}/api-keys`, locale));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {uiText(locale, "New project", "Neues Projekt")}
        </h1>
        <p className="text-gray-600 mt-1">
          {uiText(locale, "Connect your website to Deepglot and start translating.", "Verbinde deine Website mit Deepglot und starte die Übersetzung.")}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-indigo-600" />
              {uiText(locale, "Website information", "Website-Informationen")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{uiText(locale, "Project name", "Projektname")}</Label>
              <Input
                id="name"
                placeholder={uiText(locale, "e.g. My company website", "z.B. Meine Unternehmenswebsite")}
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
                {uiText(locale, "Without https://, e.g. example.com or sub.example.com", "Ohne https:// – z.B. example.com oder sub.example.com")}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{uiText(locale, "Languages", "Sprachen")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{uiText(locale, "Original website language", "Originalsprache der Website")}</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={originalLang}
                onChange={(e) => setOriginalLang(e.target.value)}
              >
                {["de", "en", "fr", "es", "it"].map((code) => (
                  <option key={code} value={code}>
                    {getLanguageName(code, locale)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>{uiText(locale, "Translation languages", "Übersetzungssprachen")}</Label>
              <p className="text-xs text-gray-500">
                {uiText(locale, "Choose the languages you want to translate into.", "Wähle die Sprachen, in die du übersetzen möchtest.")}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {popularLanguages.filter((l) => l.code !== originalLang).map(
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
                  {selectedLangs.length}{" "}
                  {locale === "de"
                    ? `Sprache${selectedLangs.length > 1 ? "n" : ""} ausgewählt`
                    : `language${selectedLangs.length > 1 ? "s" : ""} selected`}
                  :{" "}
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
            {uiText(locale, "Cancel", "Abbrechen")}
          </Button>
          <Button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-700"
            disabled={isLoading}
          >
            {isLoading
              ? uiText(locale, "Creating...", "Wird erstellt...")
              : uiText(locale, "Create project", "Projekt erstellen")}
          </Button>
        </div>
      </form>
    </div>
  );
}
