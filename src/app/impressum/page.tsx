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
      "Company and contact information for the operator of Deepglot.",
      "Unternehmens- und Kontaktangaben zum Betreiber von Deepglot."
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
        uiText(
          locale,
          "Company and contact information for the operator of Deepglot. Last updated: 14 July 2026.",
          "Unternehmens- und Kontaktangaben zum Betreiber von Deepglot. Stand: 14. Juli 2026."
        )
      }
      sections={[
        {
          title: uiText(locale, "Operator", "Betreiber"),
          body: uiText(
            locale,
            "Ostheimer OG, Fabriksgasse 20, 2230 Gänserndorf, Austria.",
            "Ostheimer OG, Fabriksgasse 20, 2230 Gänserndorf, Österreich."
          ),
        },
        {
          title: uiText(locale, "Company register and tax number", "Firmenbuch und UID"),
          body: uiText(
            locale,
            "Company register number: FN 613327b. VAT identification number: ATU79912016.",
            "Firmenbuchnummer: FN 613327b. Umsatzsteuer-Identifikationsnummer: ATU79912016."
          ),
        },
        {
          title: uiText(locale, "Partners", "Gesellschafter"),
          body: uiText(
            locale,
            "Andreas Ostheimer holds 50% and Sabine Ostheimer holds 50% of Ostheimer OG.",
            "Andreas Ostheimer hält 50 % und Sabine Ostheimer hält 50 % an der Ostheimer OG."
          ),
        },
        {
          title: uiText(locale, "Contact", "Kontakt"),
          body: uiText(
            locale,
            "Email: office@ostheimer.at. Telephone: +43 699 1726 3544.",
            "E-Mail: office@ostheimer.at. Telefon: +43 699 1726 3544."
          ),
        },
        {
          title: uiText(locale, "Business activity", "Unternehmensgegenstand"),
          body: uiText(
            locale,
            "Deepglot is a software service for website translation, project administration, and WordPress integration. Self-hosted operation is also supported under the applicable software and third-party licence terms.",
            "Deepglot ist ein Softwaredienst für Website-Übersetzungen, Projektverwaltung und WordPress-Integration. Ein selbst gehosteter Betrieb wird ebenfalls nach Maßgabe der anwendbaren Software- und Drittanbieter-Lizenzbedingungen unterstützt."
          ),
        },
        {
          title: uiText(locale, "Content and external links", "Inhalte und externe Links"),
          body: uiText(
            locale,
            "We maintain our own content with reasonable care. External websites are controlled by their respective operators. Mandatory statutory liability remains unaffected.",
            "Wir pflegen eigene Inhalte mit angemessener Sorgfalt. Für externe Websites sind deren jeweilige Betreiber verantwortlich. Zwingende gesetzliche Haftungsbestimmungen bleiben unberührt."
          ),
        },
      ]}
    />
  );
}
