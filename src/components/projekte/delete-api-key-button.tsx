"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { uiText } from "@/lib/static-copy";

type DeleteApiKeyButtonProps = {
  apiKeyId: string;
  projectId: string;
};

export function DeleteApiKeyButton({
  apiKeyId,
  projectId,
}: DeleteApiKeyButtonProps) {
  const locale = useLocale();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  async function handleDelete() {
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/api-keys/${apiKeyId}`,
        { method: "DELETE" }
      );
      const data = await response.json();

      if (!response.ok) {
        toast.error(
          data.error ??
            (uiText(locale, "Could not delete API key", "API-Key konnte nicht gelöscht werden"))
        );
        return;
      }

      toast.success(
        uiText(locale, "API key deleted", "API-Key gelöscht")
      );
      router.refresh();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
          <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {uiText(locale, "Delete API key?", "API-Key löschen?")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {uiText(locale, "The key can no longer be used by your plugin afterwards.", "Der Schlüssel kann danach nicht mehr für dein Plugin verwendet werden.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {uiText(locale, "Cancel", "Abbrechen")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isLoading}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {isLoading
              ? uiText(locale, "Deleting...", "Löschen...")
              : uiText(locale, "Delete API key", "API-Key löschen")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
