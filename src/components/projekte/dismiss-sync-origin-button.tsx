"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { uiText } from "@/lib/static-copy";

type DismissSyncOriginButtonProps = {
  projectId: string;
  siteHost: string;
};

export function DismissSyncOriginButton({
  projectId,
  siteHost,
}: DismissSyncOriginButtonProps) {
  const locale = useLocale();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  async function handleDismiss() {
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/runtime-sync-origin`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteHost }),
        }
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 409) {
          router.refresh();
        }
        toast.error(
          data.error ??
            uiText(locale, "Could not dismiss the warning", "Warnung konnte nicht verworfen werden")
        );
        return;
      }

      toast.success(
        uiText(locale, "Warning dismissed. The next plugin sync records the site again.", "Warnung verworfen. Die nächste Plugin-Synchronisierung erfasst die Website erneut.")
      );
      router.refresh();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="text-amber-900 hover:bg-amber-100"
      onClick={handleDismiss}
      disabled={isLoading}
    >
      {isLoading
        ? uiText(locale, "Saving...", "Wird gespeichert...")
        : uiText(locale, "Dismiss", "Verwerfen")}
    </Button>
  );
}
