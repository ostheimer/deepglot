"use client";

import { useState } from "react";

interface Props {
  stripeCustomerId: string | null;
  label: string;
}

export function PortalButton({ stripeCustomerId, label }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (!stripeCustomerId) return;
    setLoading(true);
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    setLoading(false);
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading || !stripeCustomerId}
      className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
    >
      {loading ? "Weiterleiten…" : label}
    </button>
  );
}
