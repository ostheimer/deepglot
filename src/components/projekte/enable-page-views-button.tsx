"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { pageViewText } from "@/lib/page-view-copy";
import { uiText } from "@/lib/static-copy";

type EnablePageViewsButtonProps = {
  projectId: string;
  enabled?: boolean;
};

export function EnablePageViewsButton({
  projectId,
  enabled = false,
}: EnablePageViewsButtonProps) {
  const locale = useLocale();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  async function handleToggle() {
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/page-views/activate`,
        { method: enabled ? "DELETE" : "POST" }
      );
      const data = await response.json();

      if (!response.ok) {
        toast.error(
          data.error ??
            (enabled
              ? pageViewText(locale, "disableError")
              : uiText(locale, "Could not enable page views", "Seitenaufrufe konnten nicht aktiviert werden"))
        );
        return;
      }

      toast.success(
        enabled
          ? pageViewText(locale, "disabledSuccess")
          : uiText(locale, "Page views enabled", "Seitenaufrufe aktiviert")
      );
      router.refresh();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Button
      className={enabled ? "px-4" : "bg-brand-600 hover:bg-brand-700 px-8"}
      variant={enabled ? "outline" : "default"}
      onClick={handleToggle}
      disabled={isLoading}
    >
      <BarChart3 className="mr-2 h-4 w-4" />
      {isLoading
        ? enabled
          ? uiText(locale, "Saving...", "Wird gespeichert...")
          : uiText(locale, "Enabling...", "Wird aktiviert...")
        : enabled
          ? pageViewText(locale, "disable")
          : uiText(locale, "Enable", "Aktivieren")}
    </Button>
  );
}
