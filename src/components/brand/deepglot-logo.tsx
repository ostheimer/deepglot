import Image from "next/image";

import { cn } from "@/lib/utils";

type DeepglotLogoProps = {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
  compact?: boolean;
  priority?: boolean;
};

export function DeepglotLogo({
  className,
  markClassName,
  wordmarkClassName,
  compact = false,
  priority = false,
}: DeepglotLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Image
        src="/marketing/deepglot-mark-transparent.png"
        alt=""
        width={56}
        height={56}
        className={cn("h-10 w-10 shrink-0", markClassName)}
        priority={priority}
      />
      {!compact && (
        <span
          className={cn(
            "text-xl font-extrabold tracking-[-0.04em] text-[#071521]",
            wordmarkClassName
          )}
        >
          Deepglot
        </span>
      )}
    </span>
  );
}
