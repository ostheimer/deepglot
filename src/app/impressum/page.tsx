import type { Metadata } from "next";

import { SimpleMarketingPage } from "@/components/marketing/simple-marketing-page";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";

type LegalNoticePageProps = {
  searchParams: LocaleSearchParams;
};

export const metadata: Metadata = {
  title: "Legal Notice",
  description: "Deepglot legal notice.",
};

export default async function LegalNoticePage({
  searchParams,
}: LegalNoticePageProps) {
  const locale = await getPageLocale(searchParams);

  return (
    <SimpleMarketingPage
      locale={locale}
      eyebrow={locale === "de" ? "Rechtliches" : "Legal"}
      title={locale === "de" ? "Impressum" : "Legal Notice"}
      description={
        locale === "de"
          ? "Angaben zum Betreiber von Deepglot."
          : "Operator information for Deepglot."
      }
      sections={[
        {
          title: locale === "de" ? "Betreiber" : "Operator",
          body: "Andreas Ostheimer, Ostheimer Online-Marketing, Austria.",
        },
        {
          title: locale === "de" ? "Kontakt" : "Contact",
          body: "office@ostheimer.at",
        },
        {
          title: locale === "de" ? "Haftung" : "Liability",
          body:
            locale === "de"
              ? "Diese Angaben dienen als technische Platzhalterseite für die Deepglot-Webanwendung und werden vor dem kommerziellen Launch final juristisch geprüft."
              : "This information is a technical placeholder page for the Deepglot web app and will receive final legal review before commercial launch.",
        },
      ]}
    />
  );
}
