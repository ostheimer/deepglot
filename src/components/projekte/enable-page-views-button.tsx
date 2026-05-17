"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { uiText } from "@/lib/static-copy";

type EnablePageViewsButtonProps = {
  projectId: string;
};

export function EnablePageViewsButton({
  projectId,
}: EnablePageViewsButtonProps) {
  const locale = useLocale();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  async function handleEnable() {
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/page-views/activate`,
        { method: "POST" }
      );
      const data = await response.json();

      if (!response.ok) {
        toast.error(
          data.error ??
            (uiText(locale, "Could not enable page views", "Seitenaufrufe konnten nicht aktiviert werden"))
        );
        return;
      }

      toast.success(
        uiText(locale, "Page views enabled", "Seitenaufrufe aktiviert")
      );
      router.refresh();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Button
      className="bg-indigo-600 hover:bg-indigo-700 px-8"
      onClick={handleEnable}
      disabled={isLoading}
    >
      <BarChart3 className="mr-2 h-4 w-4" />
      {isLoading
        ? uiText(locale, "Enabling...", "Aktiviert...")
        : uiText(locale, "Enable", "Aktivieren")}
    </Button>
  );
}
