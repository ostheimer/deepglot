"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Key } from "lucide-react";
import { useLocale } from "@/components/providers/locale-provider";
import { CopyApiKeyButton } from "@/components/projekte/copy-api-key-button";

interface Props {
  projectId: string;
}

/**
 * Reads a newly-generated API key from sessionStorage (written by the project
 * creation form) and displays it once in a prominent success banner.
 * The entry is removed from sessionStorage immediately after first read so it
 * never appears again.
 */
export function NewApiKeyBanner({ projectId }: Props) {
  const locale = useLocale();
  const [apiKey, setApiKey] = useState<{ rawKey: string; keyName: string } | null>(null);

  useEffect(() => {
    const storageKey = `deepglot_new_api_key_${projectId}`;
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      try {
        setApiKey(JSON.parse(stored));
      } catch {
        // ignore malformed entry
      }
      sessionStorage.removeItem(storageKey);
    }
  }, [projectId]);

  if (!apiKey) return null;

  return (
    <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 rounded-full bg-emerald-100 p-2.5">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-emerald-900">
            {locale === "de"
              ? "Projekt erstellt – API-Key ist bereit"
              : "Project created – API key is ready"}
          </p>
          <p className="mt-1 text-sm text-emerald-700">
            {locale === "de"
              ? "Dieser Schlüssel wird nur einmal angezeigt. Kopiere ihn jetzt und trage ihn in dein WordPress-Plugin ein."
              : "This key is shown only once. Copy it now and paste it into your WordPress plugin."}
          </p>

          <div className="mt-3 flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2">
              <Key className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
              <code className="min-w-0 flex-1 overflow-x-auto text-xs text-gray-800">
                {apiKey.rawKey}
              </code>
            </div>
            <CopyApiKeyButton value={apiKey.rawKey} />
          </div>

          <p className="mt-2 text-xs text-emerald-600">
            {locale === "de"
              ? `Name: „${apiKey.keyName}" – erscheint in der Liste unten.`
              : `Name: "${apiKey.keyName}" – appears in the list below.`}
          </p>
        </div>
      </div>
    </div>
  );
}
