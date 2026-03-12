"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

type CopyApiKeyButtonProps = {
  value: string;
  className?: string;
};

export function CopyApiKeyButton({
  value,
  className,
}: CopyApiKeyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className={className ?? "h-11 px-3 flex-shrink-0"}
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-600" />
      ) : (
        <Copy className="h-4 w-4 text-gray-500" />
      )}
    </Button>
  );
}
