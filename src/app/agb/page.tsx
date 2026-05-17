import type { Metadata } from "next";

import { SimpleMarketingPage } from "@/components/marketing/simple-marketing-page";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

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
      eyebrow={uiText(locale, "Legal", "Rechtliches")}
      title={locale === "de" ? "AGB" : "Terms"}
      description={
        uiText(locale, "Basic terms for using Deepglot.", "Grundlagen für die Nutzung von Deepglot.")
      }
      sections={[
        {
          title: uiText(locale, "Usage", "Nutzung"),
          body:
            uiText(locale, "Deepglot provides software features for website translation, project management, and WordPress integration.", "Deepglot stellt Softwarefunktionen für Website-Übersetzungen, Projektverwaltung und WordPress-Integration bereit."),
        },
        {
          title: uiText(locale, "Billing", "Abrechnung"),
          body:
            uiText(locale, "Paid plans and billing will be finalized before the Stripe payment flows are enabled.", "Kostenpflichtige Pläne und Abrechnung werden vor der Live-Schaltung der Stripe-Zahlungsflüsse finalisiert."),
        },
        {
          title: uiText(locale, "Support", "Support"),
          body:
            uiText(locale, "Support requests can be sent to office@ostheimer.at.", "Support-Anfragen können an office@ostheimer.at gesendet werden."),
        },
      ]}
    />
  );
}
