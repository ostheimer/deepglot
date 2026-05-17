"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { useLocale } from "@/components/providers/locale-provider";
import { getMarketingPath } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

export function AccountDeleteButton() {
  const locale = useLocale();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    const res = await fetch("/api/user", { method: "DELETE" });
    if (res.ok) {
      router.push(getMarketingPath(locale, "login"));
    }
    setLoading(false);
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="text-sm text-red-500 hover:text-red-700 hover:underline transition-colors">
          {uiText(locale, "Delete account", "Konto löschen")}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {uiText(locale, "Delete account?", "Konto wirklich löschen?")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {uiText(locale, "This action cannot be undone. All of your projects, translations, and API keys will be permanently deleted.", "Diese Aktion kann nicht rückgängig gemacht werden. Alle deine Projekte, Übersetzungen und API-Schlüssel werden dauerhaft gelöscht.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{uiText(locale, "Cancel", "Abbrechen")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {loading
              ? uiText(locale, "Deleting...", "Löschen…")
              : uiText(locale, "Delete account", "Konto löschen")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
