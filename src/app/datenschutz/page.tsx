import type { Metadata } from "next";

import { SimpleMarketingPage } from "@/components/marketing/simple-marketing-page";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";

type PrivacyPageProps = {
  searchParams: LocaleSearchParams;
};

export const metadata: Metadata = {
  title: "Privacy",
  description: "Deepglot privacy information.",
};

export default async function PrivacyPage({ searchParams }: PrivacyPageProps) {
  const locale = await getPageLocale(searchParams);

  return (
    <SimpleMarketingPage
      locale={locale}
      eyebrow={locale === "de" ? "Rechtliches" : "Legal"}
      title={locale === "de" ? "Datenschutz" : "Privacy"}
      description={
        locale === "de"
          ? "Diese Seite fasst zusammen, welche Daten Deepglot für Betrieb, Support und Abrechnung verarbeitet."
          : "This page summarizes which data Deepglot processes for product operation, support, and billing."
      }
      sections={[
        {
          title: locale === "de" ? "Kontodaten" : "Account data",
          body:
            locale === "de"
              ? "Wir verarbeiten Kontaktdaten, Login-Daten und Projektkonfigurationen, damit du Deepglot nutzen kannst."
              : "We process contact details, login data, and project configuration so you can use Deepglot.",
        },
        {
          title: locale === "de" ? "Übersetzungsdaten" : "Translation data",
          body:
            locale === "de"
              ? "Übersetzungsinhalte werden zur Bereitstellung der Übersetzungsfunktionen verarbeitet und in deinem Projekt gespeichert."
              : "Translation content is processed to provide translation features and stored in your project.",
        },
        {
          title: locale === "de" ? "Kontakt" : "Contact",
          body:
            locale === "de"
              ? "Für Datenschutzfragen erreichst du uns unter office@ostheimer.at."
              : "For privacy questions, contact office@ostheimer.at.",
        },
      ]}
    />
  );
}
