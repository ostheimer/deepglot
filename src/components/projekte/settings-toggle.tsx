"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";

interface SettingsToggleProps {
  label: string;
  description: string;
  defaultChecked?: boolean;
  checked?: boolean;
  disabled?: boolean;
  className?: string;
  onChange?: (checked: boolean) => void;
  onCheckedChange?: (checked: boolean) => void;
}

export function SettingsToggle({
  label,
  description,
  defaultChecked = false,
  checked: controlledChecked,
  disabled = false,
  className,
  onChange,
  onCheckedChange,
}: SettingsToggleProps) {
  const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked);
  const labelId = useId();
  const descriptionId = useId();
  const checked = controlledChecked ?? uncontrolledChecked;

  function handleToggle() {
    if (disabled) return;
    const next = !checked;
    if (controlledChecked === undefined) {
      setUncontrolledChecked(next);
    }
    onChange?.(next);
    onCheckedChange?.(next);
  }

  return (
    <div className={cn("bg-white p-5", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p id={labelId} className="text-sm font-medium text-gray-900">
            {label}
          </p>
          <p
            id={descriptionId}
            className="text-xs text-gray-500 mt-0.5 leading-relaxed"
          >
            {description}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          onClick={handleToggle}
          disabled={disabled}
          className={cn(
            "relative flex-shrink-0 h-6 w-11 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
            checked ? "bg-brand-600" : "bg-gray-200",
            disabled && "cursor-not-allowed opacity-40",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200",
              checked ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>
    </div>
  );
}
