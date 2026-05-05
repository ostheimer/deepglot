import type { Metadata } from "next";

import { SimpleMarketingPage } from "@/components/marketing/simple-marketing-page";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";

type DocsPageProps = {
  searchParams: LocaleSearchParams;
};

export const metadata: Metadata = {
  title: "Documentation",
  description: "Deepglot setup and product documentation.",
};

export default async function DocsPage({ searchParams }: DocsPageProps) {
  const locale = await getPageLocale(searchParams);

  return (
    <SimpleMarketingPage
      locale={locale}
      active="docs"
      eyebrow={locale === "de" ? "Dokumentation" : "Documentation"}
      title={locale === "de" ? "Deepglot einrichten" : "Set up Deepglot"}
      description={
        locale === "de"
          ? "Die wichtigsten Schritte für den Start mit Deepglot und dem WordPress-Plugin."
          : "The essential setup path for Deepglot and the WordPress plugin."
      }
      sections={[
        {
          title: locale === "de" ? "1. Projekt erstellen" : "1. Create a project",
          body:
            locale === "de"
              ? "Lege im Dashboard ein Projekt an, wähle Quell- und Zielsprachen und kopiere den API-Key."
              : "Create a dashboard project, choose source and target languages, and copy the API key.",
        },
        {
          title:
            locale === "de"
              ? "2. WordPress-Plugin verbinden"
              : "2. Connect the WordPress plugin",
          body:
            locale === "de"
              ? "Installiere das Plugin in WordPress, füge den API-Key ein und nutze den Verbindungstest."
              : "Install the plugin in WordPress, paste the API key, and run the connection test.",
        },
        {
          title:
            locale === "de"
              ? "3. Übersetzungen prüfen"
              : "3. Verify translations",
          body:
            locale === "de"
              ? "Öffne die Sprach-URL, prüfe Navigation, hreflang und Cache-Verhalten, bevor du weitere Sprachen aktivierst."
              : "Open the translated language URL and verify navigation, hreflang, and cache behavior before enabling more languages.",
        },
      ]}
    />
  );
}
