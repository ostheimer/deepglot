"use client";

import { useState } from "react";

interface Props {
  defaultChecked: boolean;
}

export function AutoUpgradeToggle({ defaultChecked }: Props) {
  const [checked, setChecked] = useState(defaultChecked);

  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => setChecked((v) => !v)}
      className={`relative flex-shrink-0 h-5 w-9 rounded-full transition-colors duration-200 ${
        checked ? "bg-indigo-600" : "bg-gray-200"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
