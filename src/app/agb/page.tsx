import type { Metadata } from "next";

import { SimpleMarketingPage } from "@/components/marketing/simple-marketing-page";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";

type TermsPageProps = {
  searchParams: LocaleSearchParams;
};

export const metadata: Metadata = {
  title: "Terms",
  description: "Deepglot terms summary.",
};

export default async function TermsPage({ searchParams }: TermsPageProps) {
  const locale = await getPageLocale(searchParams);

  return (
    <SimpleMarketingPage
      locale={locale}
      eyebrow={locale === "de" ? "Rechtliches" : "Legal"}
      title={locale === "de" ? "AGB" : "Terms"}
      description={
        locale === "de"
          ? "Grundlagen für die Nutzung von Deepglot."
          : "Basic terms for using Deepglot."
      }
      sections={[
        {
          title: locale === "de" ? "Nutzung" : "Usage",
          body:
            locale === "de"
              ? "Deepglot stellt Softwarefunktionen für Website-Übersetzungen, Projektverwaltung und WordPress-Integration bereit."
              : "Deepglot provides software features for website translation, project management, and WordPress integration.",
        },
        {
          title: locale === "de" ? "Abrechnung" : "Billing",
          body:
            locale === "de"
              ? "Kostenpflichtige Pläne und Abrechnung werden vor der Live-Schaltung der Stripe-Zahlungsflüsse finalisiert."
              : "Paid plans and billing will be finalized before the Stripe payment flows are enabled.",
        },
        {
          title: locale === "de" ? "Support" : "Support",
          body:
            locale === "de"
              ? "Support-Anfragen können an office@ostheimer.at gesendet werden."
              : "Support requests can be sent to office@ostheimer.at.",
        },
      ]}
    />
  );
}
