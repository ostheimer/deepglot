import type { Metadata } from "next";

import { SimpleMarketingPage } from "@/components/marketing/simple-marketing-page";
import { buildMarketingMetadata } from "@/lib/marketing-metadata";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

type LegalNoticePageProps = {
  searchParams: LocaleSearchParams;
};

export async function generateMetadata({
  searchParams,
}: LegalNoticePageProps): Promise<Metadata> {
  const locale = await getPageLocale(searchParams);

  return buildMarketingMetadata({
    locale,
    route: "legalNotice",
    title: uiText(locale, "Legal Notice", "Impressum"),
    description: uiText(
      locale,
      "Operator information for Deepglot.",
      "Angaben zum Betreiber von Deepglot."
    ),
  });
}

export default async function LegalNoticePage({
  searchParams,
}: LegalNoticePageProps) {
  const locale = await getPageLocale(searchParams);

  return (
    <SimpleMarketingPage
      locale={locale}
      eyebrow={uiText(locale, "Legal", "Rechtliches")}
      title={uiText(locale, "Legal Notice", "Impressum")}
      description={
        uiText(locale, "Operator information for Deepglot.", "Angaben zum Betreiber von Deepglot.")
      }
      sections={[
        {
          title: uiText(locale, "Operator", "Betreiber"),
          body: "Andreas Ostheimer, Ostheimer Online-Marketing, Austria.",
        },
        {
          title: uiText(locale, "Contact", "Kontakt"),
          body: "office@ostheimer.at",
        },
        {
          title: uiText(locale, "Liability", "Haftung"),
          body:
            uiText(locale, "This information is a technical placeholder page for the Deepglot web app and will receive final legal review before commercial launch.", "Diese Angaben dienen als technische Platzhalterseite für die Deepglot-Webanwendung und werden vor dem kommerziellen Launch final juristisch geprüft."),
        },
      ]}
    />
  );
}
