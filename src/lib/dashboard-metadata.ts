import type { Metadata } from "next";

import { getRequestLocale } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

export async function buildDashboardTitleMetadata(
  english: string,
  german: string,
  options: { productSuffix?: boolean } = {}
): Promise<Metadata> {
  const locale = await getRequestLocale();
  const title = uiText(locale, english, german);

  return {
    title:
      options.productSuffix === false
        ? title
        : `${title} – Deepglot`,
  };
}
