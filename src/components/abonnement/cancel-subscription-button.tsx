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

interface Props {
  subscriptionId: string | null;
  plan: string;
}

export function CancelSubscriptionButton({ subscriptionId, plan }: Props) {
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
        Kein aktives Abonnement
      </span>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="text-sm text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline transition-colors">
          Abonnement kündigen (oder pausieren)
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Abonnement wirklich kündigen?</AlertDialogTitle>
          <AlertDialogDescription>
            Dein Plan läuft bis zum Ende der aktuellen Abrechnungsperiode weiter.
            Danach wirst du auf den Free-Plan zurückgesetzt.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleCancel}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {loading ? "Kündigen…" : "Abonnement kündigen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
