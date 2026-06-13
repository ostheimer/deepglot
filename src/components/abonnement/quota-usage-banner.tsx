import Link from "next/link";

import type { SiteLocale } from "@/lib/site-locale";
import { withLocalePrefix } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";
import { quotaUsageLevel } from "@/lib/quota-usage";

/**
 * Warn the operator before and when the monthly word quota is exhausted (#148).
 *
 * Once the quota is spent, /api/translate returns 402 and new content silently
 * stays in the source language — invisible unless someone notices. This banner
 * surfaces it in the dashboard at >= 90% (warning) and >= 100% (reached), using
 * the same effective limit the translate route enforces.
 */
export function QuotaUsageBanner({
  locale,
  wordsUsed,
  wordsLimit,
}: {
  locale: SiteLocale;
  wordsUsed: number;
  wordsLimit: number;
}) {
  const level = quotaUsageLevel(wordsUsed, wordsLimit);

  if (level === "ok") {
    return null;
  }

  const reached = level === "reached";
  const percent = Math.floor((wordsUsed / wordsLimit) * 100);
  const usedLabel = wordsUsed.toLocaleString(locale);
  const limitLabel = wordsLimit.toLocaleString(locale);

  const headline = reached
    ? uiText(
        locale,
        "Monthly word limit reached",
        "Monatliches Wortlimit erreicht",
      )
    : uiText(
        locale,
        "Approaching your monthly word limit",
        "Monatliches Wortlimit fast erreicht",
      );

  const body = reached
    ? uiText(
        locale,
        "Already-translated content keeps serving, but new or changed text stays in the source language until the quota resets or you upgrade.",
        "Bereits übersetzte Inhalte werden weiter ausgeliefert, aber neue oder geänderte Texte bleiben in der Ausgangssprache, bis das Kontingent zurückgesetzt oder erhöht wird.",
      )
    : uiText(
        locale,
        "Once the limit is reached, new or changed content stays in the source language until the quota resets or you upgrade.",
        "Sobald das Limit erreicht ist, bleiben neue oder geänderte Inhalte in der Ausgangssprache, bis das Kontingent zurückgesetzt oder erhöht wird.",
      );

  const tone = reached
    ? "border-red-200 bg-red-50 text-red-800"
    : "border-amber-200 bg-amber-50 text-amber-900";

  const linkTone = reached
    ? "text-red-700 hover:text-red-900"
    : "text-amber-800 hover:text-amber-950";

  return (
    <div
      role={reached ? "alert" : "status"}
      className={`mb-6 rounded-xl border px-5 py-4 ${tone}`}
    >
      <p className="font-semibold">
        {headline}
        <span className="ml-2 font-normal opacity-80">
          {usedLabel} / {limitLabel} ({percent}%)
        </span>
      </p>
      <p className="mt-1 text-sm opacity-90">{body}</p>
      <Link
        href={withLocalePrefix("/abonnement", locale)}
        className={`mt-2 inline-block text-sm font-semibold underline ${linkTone}`}
      >
        {uiText(locale, "Manage plan", "Tarif verwalten")}
      </Link>
    </div>
  );
}
