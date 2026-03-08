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
          {locale === "de" ? "Konto löschen" : "Delete account"}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {locale === "de" ? "Konto wirklich löschen?" : "Delete account?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {locale === "de"
              ? "Diese Aktion kann nicht rückgängig gemacht werden. Alle deine Projekte, Übersetzungen und API-Schlüssel werden dauerhaft gelöscht."
              : "This action cannot be undone. All of your projects, translations, and API keys will be permanently deleted."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{locale === "de" ? "Abbrechen" : "Cancel"}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {loading
              ? locale === "de"
                ? "Löschen…"
                : "Deleting..."
              : locale === "de"
                ? "Konto löschen"
                : "Delete account"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
