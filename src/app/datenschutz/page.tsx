import type { Metadata } from "next";

import { SimpleMarketingPage } from "@/components/marketing/simple-marketing-page";
import { buildMarketingMetadata } from "@/lib/marketing-metadata";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

type PrivacyPageProps = {
  searchParams: LocaleSearchParams;
};

export async function generateMetadata({
  searchParams,
}: PrivacyPageProps): Promise<Metadata> {
  const locale = await getPageLocale(searchParams);

  return buildMarketingMetadata({
    locale,
    route: "privacy",
    title: uiText(locale, "Privacy", "Datenschutz"),
    description: uiText(
      locale,
      "This page summarizes which data Deepglot processes for product operation, support, and billing.",
      "Diese Seite fasst zusammen, welche Daten Deepglot für Betrieb, Support und Abrechnung verarbeitet."
    ),
  });
}

export default async function PrivacyPage({ searchParams }: PrivacyPageProps) {
  const locale = await getPageLocale(searchParams);

  return (
    <SimpleMarketingPage
      locale={locale}
      eyebrow={uiText(locale, "Legal", "Rechtliches")}
      title={uiText(locale, "Privacy", "Datenschutz")}
      description={
        uiText(locale, "This page summarizes which data Deepglot processes for product operation, support, and billing.", "Diese Seite fasst zusammen, welche Daten Deepglot für Betrieb, Support und Abrechnung verarbeitet.")
      }
      sections={[
        {
          title: uiText(locale, "Account data", "Kontodaten"),
          body:
            uiText(locale, "We process contact details, login data, and project configuration so you can use Deepglot.", "Wir verarbeiten Kontaktdaten, Login-Daten und Projektkonfigurationen, damit du Deepglot nutzen kannst."),
        },
        {
          title: uiText(locale, "Translation data", "Übersetzungsdaten"),
          body:
            uiText(locale, "Translation content is processed to provide translation features and stored in your project.", "Übersetzungsinhalte werden zur Bereitstellung der Übersetzungsfunktionen verarbeitet und in deinem Projekt gespeichert."),
        },
        {
          title: uiText(locale, "Contact", "Kontakt"),
          body:
            uiText(locale, "For privacy questions, contact office@ostheimer.at.", "Für Datenschutzfragen erreichst du uns unter office@ostheimer.at."),
        },
      ]}
    />
  );
}
