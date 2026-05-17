"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Key, Plus } from "lucide-react";
import { toast } from "sonner";

import { CopyApiKeyButton } from "@/components/projekte/copy-api-key-button";
import { useLocale } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uiText } from "@/lib/static-copy";

type CreatedApiKey = {
  id: string;
  keyPrefix: string;
  name: string;
  rawKey: string;
};

type CreateApiKeyDialogProps = {
  projectId: string;
  variant?: "default" | "outline";
  size?: "default" | "sm";
  label?: string;
};

export function CreateApiKeyDialog({
  projectId,
  variant = "default",
  size = "sm",
  label,
}: CreateApiKeyDialogProps) {
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(
    uiText(locale, "WordPress plugin", "WordPress Plugin")
  );
  const [createdApiKey, setCreatedApiKey] = useState<CreatedApiKey | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const copy = useMemo(
    () => ({
      buttonLabel: label ?? uiText(locale, "Create API key", "API-Key erstellen"),
      title: uiText(locale, "Create API key", "API-Key erstellen"),
      description: uiText(
        locale,
        "Create a new key for your WordPress plugin or other integrations.",
        "Erstelle einen neuen Schlüssel für dein WordPress-Plugin oder andere Integrationen."
      ),
      nameLabel: "Name",
      namePlaceholder: uiText(locale, "e.g. WordPress plugin", "z. B. WordPress Plugin"),
      cancel: uiText(locale, "Cancel", "Abbrechen"),
      submit: uiText(locale, "Create API key", "API-Key erstellen"),
      submitting: uiText(locale, "Creating API key...", "API-Key wird erstellt..."),
      success: uiText(locale, "API key created", "API-Key erstellt"),
      error: uiText(locale, "Could not create API key", "API-Key konnte nicht erstellt werden"),
      rawKeyTitle: uiText(locale, "Full API key", "Vollständiger API-Key"),
      rawKeyHint: uiText(
        locale,
        "Copy this key now. For security reasons it is shown in full only once.",
        "Kopiere diesen Schlüssel jetzt. Er wird aus Sicherheitsgründen nur einmal vollständig angezeigt."
      ),
      done: uiText(locale, "Done", "Fertig"),
    }),
    [label, locale]
  );

  function resetDialog(nextOpen: boolean) {
    const shouldRefresh = open && !nextOpen && createdApiKey;
    setOpen(nextOpen);
    if (nextOpen) {
      setCreatedApiKey(null);
      setName(uiText(locale, "WordPress plugin", "WordPress Plugin"));
    }
    if (shouldRefresh) {
      router.refresh();
    }
  }

  async function handleCreate() {
    setIsLoading(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error ?? copy.error);
        return;
      }

      setCreatedApiKey({
        id: data.apiKey.id,
        keyPrefix: data.apiKey.keyPrefix,
        name: data.apiKey.name,
        rawKey: data.rawKey,
      });
      toast.success(copy.success);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={resetDialog}>
      <DialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={
            variant === "outline"
              ? "border-indigo-200 text-indigo-700 hover:bg-indigo-50"
              : "bg-indigo-600 hover:bg-indigo-700"
          }
        >
          <Plus className="mr-2 h-4 w-4" />
          {copy.buttonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        {createdApiKey ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-emerald-100 p-2">
                  <Key className="h-4 w-4 text-emerald-700" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900">
                    {copy.rawKeyTitle}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    {copy.rawKeyHint}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs text-gray-800">
                      {createdApiKey.rawKey}
                    </code>
                    <CopyApiKeyButton value={createdApiKey.rawKey} />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                className="bg-indigo-600 hover:bg-indigo-700"
                onClick={() => resetDialog(false)}
              >
                {copy.done}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-key-name">{copy.nameLabel}</Label>
              <Input
                id="api-key-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={copy.namePlaceholder}
                maxLength={80}
              />
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {copy.cancel}
              </Button>
              <Button
                className="bg-indigo-600 hover:bg-indigo-700"
                onClick={handleCreate}
                disabled={isLoading || name.trim().length < 2}
              >
                {isLoading ? copy.submitting : copy.submit}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
