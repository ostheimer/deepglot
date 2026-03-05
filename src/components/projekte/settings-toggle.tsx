"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface SettingsToggleProps {
  label: string;
  description: string;
  defaultChecked?: boolean;
  disabled?: boolean;
  className?: string;
  onChange?: (checked: boolean) => void;
}

export function SettingsToggle({
  label,
  description,
  defaultChecked = false,
  disabled = false,
  className,
  onChange,
}: SettingsToggleProps) {
  const [checked, setChecked] = useState(defaultChecked);

  function handleToggle() {
    if (disabled) return;
    const next = !checked;
    setChecked(next);
    onChange?.(next);
  }

  return (
    <div className={cn("bg-white p-5", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{label}</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={handleToggle}
          disabled={disabled}
          className={cn(
            "relative flex-shrink-0 h-5 w-9 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
            checked ? "bg-indigo-600" : "bg-gray-200",
            disabled && "opacity-40 cursor-not-allowed"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
              checked ? "translate-x-4" : "translate-x-0"
            )}
          />
        </button>
      </div>
    </div>
  );
}
