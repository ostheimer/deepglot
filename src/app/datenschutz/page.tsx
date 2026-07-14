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
        uiText(
          locale,
          "This notice explains how Deepglot processes personal data for accounts, translation projects, integrations, support, security, and billing. Last updated: 14 July 2026.",
          "Diese Erklärung beschreibt, wie Deepglot personenbezogene Daten für Konten, Übersetzungsprojekte, Integrationen, Support, Sicherheit und Abrechnung verarbeitet. Stand: 14. Juli 2026."
        )
      }
      sections={[
        {
          title: uiText(locale, "1. Controller", "1. Verantwortlicher"),
          body: uiText(
            locale,
            "The controller is Ostheimer OG, Fabriksgasse 20, 2230 Gänserndorf, Austria. Privacy requests can be sent to office@ostheimer.at or made by telephone at +43 699 1726 3544.",
            "Verantwortlicher ist die Ostheimer OG, Fabriksgasse 20, 2230 Gänserndorf, Österreich. Datenschutzanfragen kannst du an office@ostheimer.at oder telefonisch unter +43 699 1726 3544 richten."
          ),
        },
        {
          title: uiText(locale, "2. Account and authentication data", "2. Konto- und Authentifizierungsdaten"),
          body: uiText(
            locale,
            "We process names, email addresses, password hashes, account and organization memberships, roles, login sessions, invitation and password-reset data, and optional GitHub or Google OAuth identifiers. The legal basis is performance of the user contract and pre-contract steps; security logging and abuse prevention rely on our legitimate interest in a secure, reliable service. Where consent is specifically requested, consent is the legal basis and can be withdrawn for the future.",
            "Wir verarbeiten Namen, E-Mail-Adressen, Passwort-Hashes, Konto- und Organisationsmitgliedschaften, Rollen, Login-Sitzungen, Einladungs- und Passwort-zurücksetzen-Daten sowie optionale GitHub- oder Google-OAuth-Kennungen. Rechtsgrundlage sind die Vertragserfüllung und vorvertragliche Maßnahmen; Sicherheitsprotokollierung und Missbrauchsprävention beruhen auf unserem berechtigten Interesse an einem sicheren und zuverlässigen Dienst. Wird ausdrücklich eine Einwilligung eingeholt, ist sie die Rechtsgrundlage und kann für die Zukunft widerrufen werden."
          ),
        },
        {
          title: uiText(locale, "3. Projects and translation content", "3. Projekte und Übersetzungsinhalte"),
          body: uiText(
            locale,
            "We process project domains, languages, settings, API-key identifiers, exclusions, glossaries, imported files, source and translated text, URL and page statistics, manual translations, editor sessions, and translation usage records to provide the contracted features. Depending on the selected configuration, content is transmitted to a translation provider API such as OpenAI, DeepL, Google Gemini, OpenRouter, or a customer-specified OpenAI-compatible or self-hosted endpoint. Customer-supplied provider API keys are stored encrypted and used only for the configured provider connection.",
            "Wir verarbeiten Projektdomains, Sprachen, Einstellungen, API-Schlüssel-Kennungen, Ausnahmen, Glossare, importierte Dateien, Quell- und Übersetzungstexte, URL- und Seitenstatistiken, manuelle Übersetzungen, Editor-Sitzungen und Übersetzungsnutzungsdaten, um die vertraglichen Funktionen bereitzustellen. Je nach gewählter Konfiguration werden Inhalte an eine Übersetzungsanbieter-API wie OpenAI, DeepL, Google Gemini, OpenRouter oder an einen kundenseitig festgelegten OpenAI-kompatiblen beziehungsweise selbst gehosteten Endpoint übertragen. Vom Kunden bereitgestellte Provider-API-Schlüssel werden verschlüsselt gespeichert und nur für die konfigurierte Provider-Verbindung verwendet."
          ),
        },
        {
          title: uiText(locale, "4. WordPress, runtime sync, and webhooks", "4. WordPress, Laufzeitsynchronisierung und Webhooks"),
          body: uiText(
            locale,
            "The WordPress plugin sends its API key, site URL, language and routing settings, runtime configuration requests, translation segments, request URLs, titles, bot classification, and connection-status probes to Deepglot as needed. If you configure webhooks, selected project events and signed delivery metadata are sent to the destination you provide, and delivery status, response codes, and limited response bodies are stored for operation and troubleshooting. Dynamic translation uses same-origin and short-lived security controls and can fall back to cached content.",
            "Das WordPress-Plugin übermittelt bei Bedarf seinen API-Schlüssel, die Website-URL, Sprach- und Routing-Einstellungen, Laufzeitkonfigurationsanfragen, Übersetzungssegmente, Anfrage-URLs, Titel, Bot-Klassifizierung und Verbindungsprüfungen an Deepglot. Wenn du Webhooks konfigurierst, werden ausgewählte Projektereignisse und signierte Zustellmetadaten an das von dir angegebene Ziel gesendet; Zustellstatus, Antwortcodes und begrenzte Antwortinhalte werden für Betrieb und Fehleranalyse gespeichert. Dynamische Übersetzung nutzt Same-Origin- und kurzlebige Sicherheitskontrollen und kann auf Cache-Inhalte zurückfallen."
          ),
        },
        {
          title: uiText(locale, "5. Billing and support", "5. Abrechnung und Support"),
          body: uiText(
            locale,
            "For paid subscriptions, Stripe processes customer, checkout, payment-method, invoice, subscription, tax, and transaction data. Deepglot stores Stripe customer, subscription and price references, plan status, billing address details needed by the product, and quota information; Deepglot does not receive full card numbers. We process support messages and related technical context to answer requests. Contract performance and pre-contract steps are the main legal basis; tax, accounting, and other statutory records are processed to meet legal obligations.",
            "Für kostenpflichtige Abonnements verarbeitet Stripe Kunden-, Checkout-, Zahlungsmittel-, Rechnungs-, Abonnement-, Steuer- und Transaktionsdaten. Deepglot speichert Stripe-Kunden-, Abonnement- und Preisreferenzen, Planstatus, die im Produkt benötigten Rechnungsadressdaten und Wortlimit-Informationen; vollständige Kartennummern erhält Deepglot nicht. Support-Nachrichten und der zugehörige technische Kontext werden zur Bearbeitung von Anfragen verarbeitet. Hauptrechtsgrundlage sind Vertragserfüllung und vorvertragliche Maßnahmen; Steuer-, Buchhaltungs- und sonstige gesetzlich erforderliche Unterlagen werden zur Erfüllung rechtlicher Verpflichtungen verarbeitet."
          ),
        },
        {
          title: uiText(locale, "6. Hosting, email, and processors", "6. Hosting, E-Mail und Auftragsverarbeiter"),
          body: uiText(
            locale,
            "We use service providers as processors or independent controllers according to their role: Vercel for application hosting and runtime logs, Neon for managed PostgreSQL storage, Cloudflare Email Sending for transactional email, Stripe for billing and payments, and GitHub or Google when their OAuth login is selected. Translation providers process the content sent to the provider selected for a project. Customer-configured webhooks, custom gateways, and self-hosted services are recipients chosen by the customer. We limit disclosures to what is needed for the stated purpose and review data-processing terms with relevant processors.",
            "Wir nutzen je nach Rolle Dienstleister als Auftragsverarbeiter oder eigenständig Verantwortliche: Vercel für Anwendungshosting und Laufzeitprotokolle, Neon für verwaltete PostgreSQL-Speicherung, Cloudflare Email Sending für Transaktionsmails, Stripe für Abrechnung und Zahlungen sowie GitHub oder Google bei Auswahl des jeweiligen OAuth-Logins. Übersetzungsanbieter verarbeiten die Inhalte, die an den für ein Projekt gewählten Provider gesendet werden. Kundenseitig konfigurierte Webhooks, eigene Gateways und selbst gehostete Dienste sind vom Kunden gewählte Empfänger. Wir beschränken Übermittlungen auf die für den jeweiligen Zweck erforderlichen Daten und prüfen die Datenschutzbedingungen relevanter Auftragsverarbeiter."
          ),
        },
        {
          title: uiText(locale, "7. Logs, analytics, and security", "7. Protokolle, Statistiken und Sicherheit"),
          body: uiText(
            locale,
            "We process request times, route and error information, hashed rate-limit subjects, usage counters, translation batch metadata, webhook delivery history, and security events to operate, secure, debug, and protect the service. Optional project page-view analytics records translated URLs and aggregate use only after the feature is enabled. Deepglot does not currently use its own advertising or cross-site marketing-tracking cookies. The legal basis is contract performance and our legitimate interests in service security, fraud prevention, troubleshooting, and product reliability.",
            "Wir verarbeiten Anfragezeiten, Routen- und Fehlerinformationen, gehashte Rate-Limit-Kennungen, Nutzungszähler, Metadaten zu Übersetzungsbatches, Webhook-Zustellverläufe und Sicherheitsereignisse, um den Dienst zu betreiben, abzusichern, zu analysieren und vor Missbrauch zu schützen. Optionale projektbezogene Seitenaufruf-Statistiken erfassen übersetzte URLs und aggregierte Nutzung erst nach Aktivierung der Funktion. Deepglot verwendet derzeit keine eigenen Werbe- oder websiteübergreifenden Marketing-Tracking-Cookies. Rechtsgrundlage sind die Vertragserfüllung und unsere berechtigten Interessen an Dienstsicherheit, Betrugsprävention, Fehleranalyse und Produktzuverlässigkeit."
          ),
        },
        {
          title: uiText(locale, "8. Cookies and local storage", "8. Cookies und lokaler Speicher"),
          body: uiText(
            locale,
            "The hosted application uses technically necessary authentication, locale, and interface-state cookies. Short-lived browser storage can be used to display a newly generated API key once and is removed after it is read. Third-party services reached through login or billing may set their own cookies under their notices. Optional technologies requiring consent will not be activated without the required choice.",
            "Die gehostete Anwendung verwendet technisch notwendige Cookies für Authentifizierung, Sprache und Oberflächenzustand. Kurzlebiger Browser-Speicher kann genutzt werden, um einen neu erzeugten API-Schlüssel einmalig anzuzeigen, und wird nach dem Auslesen entfernt. Über Login oder Abrechnung aufgerufene Drittanbieter können nach ihren eigenen Erklärungen Cookies setzen. Optionale einwilligungspflichtige Technologien werden nicht ohne die erforderliche Auswahl aktiviert."
          ),
        },
        {
          title: uiText(locale, "9. International transfers", "9. Internationale Übermittlungen"),
          body: uiText(
            locale,
            "Some providers or their subprocessors may process data outside Austria or the European Economic Area. Where required, the transfer must be covered by an adequacy decision, standard contractual clauses, or another lawful transfer mechanism, together with supplementary safeguards where appropriate. The applicable destination depends in particular on the hosting, OAuth, payment, email, and translation provider selected or configured.",
            "Einige Anbieter oder deren Unterauftragsverarbeiter können Daten außerhalb Österreichs oder des Europäischen Wirtschaftsraums verarbeiten. Soweit erforderlich, muss die Übermittlung durch einen Angemessenheitsbeschluss, Standardvertragsklauseln oder einen anderen zulässigen Übermittlungsmechanismus sowie gegebenenfalls ergänzende Schutzmaßnahmen abgesichert sein. Das jeweilige Zielland hängt insbesondere vom gewählten oder konfigurierten Hosting-, OAuth-, Zahlungs-, E-Mail- und Übersetzungsanbieter ab."
          ),
        },
        {
          title: uiText(locale, "10. Retention and deletion", "10. Speicherdauer und Löschung"),
          body: uiText(
            locale,
            "Account, organization, project, translation, import/export, glossary, webhook, and related operational data are generally retained while needed to provide the account or associated project and are deleted or anonymized after deletion or a valid request unless another user still requires the organization data or a legal obligation applies. Billing and transaction records are retained for applicable statutory tax and accounting periods. Security, support, and runtime records are kept only as long as reasonably needed for their purpose. Backups can retain deleted data for a limited rotation period before overwrite. Data sent to external providers is subject to their documented retention and the customer's provider configuration.",
            "Konto-, Organisations-, Projekt-, Übersetzungs-, Import-/Export-, Glossar-, Webhook- und zugehörige Betriebsdaten werden grundsätzlich so lange gespeichert, wie sie zur Bereitstellung des Kontos oder Projekts benötigt werden, und nach Löschung oder einem berechtigten Antrag gelöscht oder anonymisiert, sofern nicht andere Benutzer die Organisationsdaten weiterhin benötigen oder eine gesetzliche Pflicht entgegensteht. Abrechnungs- und Transaktionsunterlagen werden für die anwendbaren gesetzlichen Steuer- und Buchhaltungsfristen aufbewahrt. Sicherheits-, Support- und Laufzeitprotokolle bleiben nur so lange gespeichert, wie es für ihren Zweck angemessen erforderlich ist. Backups können gelöschte Daten für einen begrenzten Rotationszeitraum bis zur Überschreibung enthalten. An externe Provider übermittelte Daten unterliegen deren dokumentierter Speicherdauer und der kundenseitigen Provider-Konfiguration."
          ),
        },
        {
          title: uiText(locale, "11. Your rights and data export", "11. Deine Rechte und Datenexport"),
          body: uiText(
            locale,
            "Subject to the GDPR and applicable law, you may request access, correction, deletion, restriction, and portability of personal data, object to processing based on legitimate interests, and withdraw consent for the future. The project import/export tools can export translations, glossaries, and URL slugs; other privacy requests and account deletion can be made through the product or by email. You may lodge a complaint with the Austrian Data Protection Authority or another competent supervisory authority. We may verify identity before fulfilling a request.",
            "Nach Maßgabe der DSGVO und des anwendbaren Rechts kannst du Auskunft, Berichtigung, Löschung, Einschränkung und Übertragbarkeit personenbezogener Daten verlangen, einer auf berechtigte Interessen gestützten Verarbeitung widersprechen und eine Einwilligung für die Zukunft widerrufen. Über die Projektfunktionen für Import und Export lassen sich Übersetzungen, Glossare und URL-Slugs exportieren; weitere Datenschutzanfragen und die Kontolöschung sind über das Produkt oder per E-Mail möglich. Du kannst dich bei der österreichischen Datenschutzbehörde oder einer anderen zuständigen Aufsichtsbehörde beschweren. Vor der Erfüllung eines Antrags dürfen wir die Identität prüfen."
          ),
        },
        {
          title: uiText(locale, "12. Changes and contact", "12. Änderungen und Kontakt"),
          body: uiText(
            locale,
            "We update this notice when material product, processor, legal-basis, or retention changes occur. For privacy questions, objections, or deletion and export requests, contact office@ostheimer.at.",
            "Wir aktualisieren diese Erklärung bei wesentlichen Änderungen an Produkt, Auftragsverarbeitern, Rechtsgrundlagen oder Speicherdauer. Für Datenschutzfragen, Widersprüche sowie Lösch- und Exportanfragen erreichst du uns unter office@ostheimer.at."
          ),
        },
      ]}
    />
  );
}
