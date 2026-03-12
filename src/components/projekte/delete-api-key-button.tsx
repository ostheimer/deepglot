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
            (locale === "de"
              ? "API-Key konnte nicht geloescht werden"
              : "Could not delete API key")
        );
        return;
      }

      toast.success(
        locale === "de" ? "API-Key geloescht" : "API key deleted"
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
            {locale === "de" ? "API-Key loeschen?" : "Delete API key?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {locale === "de"
              ? "Der Schluessel kann danach nicht mehr fuer dein Plugin verwendet werden."
              : "The key can no longer be used by your plugin afterwards."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {locale === "de" ? "Abbrechen" : "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isLoading}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {isLoading
              ? locale === "de"
                ? "Loeschen..."
                : "Deleting..."
              : locale === "de"
                ? "API-Key loeschen"
                : "Delete API key"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
