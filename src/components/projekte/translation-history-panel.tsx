"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { historyText } from "@/lib/translation-history-copy";
import type { SiteLocale } from "@/lib/site-locale";

type HistoryPage = {
  items: Array<{ id: string; beforeText: string; afterText: string; createdAt: string; actor: { name: string | null } | null }>;
  nextCursor: string | null;
};

export function TranslationHistoryPanel({ projectId, translationId, locale }: {
  projectId: string; translationId: string; locale: SiteLocale;
}) {
  const [data, setData] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  async function load(cursor?: string) {
    if (loading) return;
    setLoading(true);
    setError(false);
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const response = await fetch(`/api/projects/${projectId}/translations/${translationId}/history${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("History unavailable");
      const page: HistoryPage = await response.json();
      setData((current) => ({ ...page, items: cursor ? [...(current?.items ?? []), ...page.items] : page.items }));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  return (
    <details className="rounded-md border border-gray-200 p-3 text-sm" onToggle={(event) => {
      if (event.currentTarget.open && !data && !loading) void load();
    }}>
      <summary className="cursor-pointer font-medium">{historyText(locale, "title")}</summary>
      <p className="mt-2 text-xs text-gray-500">{historyText(locale, "scope")}</p>
      {data?.items.length === 0 && <p className="mt-3">{historyText(locale, "empty")}</p>}
      <ol className="mt-3 space-y-3">
        {data?.items.map((item) => <li key={item.id} className="rounded border p-3">
          <p className="text-xs text-gray-500"><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(locale)}</time> · {item.actor?.name || historyText(locale, "unknown")}</p>
          <dl className="mt-2 space-y-2">
            <div><dt className="font-medium">{historyText(locale, "before")}</dt><dd className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{item.beforeText}</dd></div>
            <div><dt className="font-medium">{historyText(locale, "after")}</dt><dd className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{item.afterText}</dd></div>
          </dl>
        </li>)}
      </ol>
      {error && <p role="alert" className="mt-3 text-red-600">{historyText(locale, "error")}</p>}
      {(loading || error || data?.nextCursor) && <Button className="mt-3" variant="outline" size="sm" disabled={loading} onClick={() => void load(data?.nextCursor ?? undefined)}>
        {historyText(locale, loading ? "loading" : error ? "retry" : "more")}
      </Button>}
    </details>
  );
}
