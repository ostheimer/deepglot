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
    locale === "de" ? "WordPress Plugin" : "WordPress plugin"
  );
  const [createdApiKey, setCreatedApiKey] = useState<CreatedApiKey | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const copy = useMemo(
    () =>
      locale === "de"
        ? {
            buttonLabel: label ?? "API-Key erstellen",
            title: "API-Key erstellen",
            description:
              "Erstelle einen neuen Schluessel fuer dein WordPress-Plugin oder andere Integrationen.",
            nameLabel: "Name",
            namePlaceholder: "z. B. WordPress Plugin",
            cancel: "Abbrechen",
            submit: "API-Key erstellen",
            submitting: "API-Key wird erstellt...",
            success: "API-Key erstellt",
            error: "API-Key konnte nicht erstellt werden",
            rawKeyTitle: "Vollstaendiger API-Key",
            rawKeyHint:
              "Kopiere diesen Schluessel jetzt. Er wird aus Sicherheitsgruenden nur einmal vollstaendig angezeigt.",
            done: "Fertig",
          }
        : {
            buttonLabel: label ?? "Create API key",
            title: "Create API key",
            description:
              "Create a new key for your WordPress plugin or other integrations.",
            nameLabel: "Name",
            namePlaceholder: "e.g. WordPress plugin",
            cancel: "Cancel",
            submit: "Create API key",
            submitting: "Creating API key...",
            success: "API key created",
            error: "Could not create API key",
            rawKeyTitle: "Full API key",
            rawKeyHint:
              "Copy this key now. For security reasons it is shown in full only once.",
            done: "Done",
          },
    [label, locale]
  );

  function resetDialog(nextOpen: boolean) {
    const shouldRefresh = open && !nextOpen && createdApiKey;
    setOpen(nextOpen);
    if (nextOpen) {
      setCreatedApiKey(null);
      setName(locale === "de" ? "WordPress Plugin" : "WordPress plugin");
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
                onClick={() => setOpen(false)}
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
