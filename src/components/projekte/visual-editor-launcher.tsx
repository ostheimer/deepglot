"use client";

import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { useLocale } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { getLanguageName } from "@/lib/language-names";

type VisualEditorLauncherProps = {
  projectId: string;
  languages: Array<{ id: string; langCode: string }>;
};

export function VisualEditorLauncher({
  projectId,
  languages,
}: VisualEditorLauncherProps) {
  const locale = useLocale();
  const [langTo, setLangTo] = useState(languages[0]?.langCode ?? "en");
  const [isPending, startTransition] = useTransition();

  async function startEditor() {
    startTransition(async () => {
      const response = await fetch(`/api/projects/${projectId}/editor-sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ langTo }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        launchUrl?: string;
      };

      if (!response.ok || !data.launchUrl) {
        toast.error(
          data.error ??
            (locale === "de"
              ? "Editor konnte nicht gestartet werden"
              : "Could not start editor")
        );
        return;
      }

      window.open(data.launchUrl, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
      <select
        value={langTo}
        onChange={(event) => setLangTo(event.target.value)}
        className="flex h-10 min-w-56 rounded-md border border-input bg-white px-3 py-1 text-sm"
      >
        {languages.map((language) => (
          <option key={language.id} value={language.langCode}>
            {getLanguageName(language.langCode, locale)}
          </option>
        ))}
      </select>
      <Button
        type="button"
        className="bg-indigo-600 hover:bg-indigo-700"
        disabled={isPending || languages.length === 0}
        onClick={() => void startEditor()}
      >
        <ExternalLink className="mr-2 h-4 w-4" />
        {locale === "de" ? "Bearbeitung starten" : "Start editing"}
      </Button>
    </div>
  );
}
