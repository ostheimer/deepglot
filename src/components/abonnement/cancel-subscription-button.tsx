"use client";

import { useState } from "react";
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

interface Props {
  subscriptionId: string | null;
  plan: string;
}

export function CancelSubscriptionButton({ subscriptionId, plan }: Props) {
  const locale = useLocale();
  const [loading, setLoading] = useState(false);

  async function handleCancel() {
    if (!subscriptionId) return;
    setLoading(true);
    await fetch("/api/billing/cancel", { method: "POST" });
    setLoading(false);
    window.location.reload();
  }

  if (plan === "FREE") {
    return (
      <span className="text-sm text-gray-400 cursor-default">
        {locale === "de" ? "Kein aktives Abonnement" : "No active subscription"}
      </span>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="text-sm text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline transition-colors">
          {locale === "de" ? "Abonnement kündigen (oder pausieren)" : "Cancel subscription (or pause)"}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {locale === "de" ? "Abonnement wirklich kündigen?" : "Cancel subscription?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {locale === "de"
              ? "Dein Plan läuft bis zum Ende der aktuellen Abrechnungsperiode weiter. Danach wirst du auf den Free-Plan zurückgesetzt."
              : "Your plan will remain active until the end of the current billing period. After that, you will be moved back to the Free plan."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{locale === "de" ? "Abbrechen" : "Cancel"}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleCancel}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {loading
              ? locale === "de"
                ? "Kündigen…"
                : "Cancelling..."
              : locale === "de"
                ? "Abonnement kündigen"
                : "Cancel subscription"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
