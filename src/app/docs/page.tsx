import type { Metadata } from "next";

import { SimpleMarketingPage } from "@/components/marketing/simple-marketing-page";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

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
      eyebrow={uiText(locale, "Documentation", "Dokumentation")}
      title={uiText(locale, "Set up Deepglot", "Deepglot einrichten")}
      description={
        uiText(locale, "The essential setup path for Deepglot and the WordPress plugin.", "Die wichtigsten Schritte für den Start mit Deepglot und dem WordPress-Plugin.")
      }
      sections={[
        {
          title: uiText(locale, "1. Create a project", "1. Projekt erstellen"),
          body:
            uiText(locale, "Create a dashboard project, choose source and target languages, and copy the API key.", "Lege im Dashboard ein Projekt an, wähle Quell- und Zielsprachen und kopiere den API-Key."),
        },
        {
          title:
            uiText(locale, "2. Connect the WordPress plugin", "2. WordPress-Plugin verbinden"),
          body:
            uiText(locale, "Install the plugin in WordPress, paste the API key, and run the connection test.", "Installiere das Plugin in WordPress, füge den API-Key ein und nutze den Verbindungstest."),
        },
        {
          title:
            uiText(locale, "3. Verify translations", "3. Übersetzungen prüfen"),
          body:
            uiText(locale, "Open the translated language URL and verify navigation, hreflang, and cache behavior before enabling more languages.", "Öffne die Sprach-URL, prüfe Navigation, hreflang und Cache-Verhalten, bevor du weitere Sprachen aktivierst."),
        },
      ]}
    />
  );
}
