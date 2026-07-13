import type { Metadata } from "next";

import { SimpleMarketingPage } from "@/components/marketing/simple-marketing-page";
import { buildMarketingMetadata } from "@/lib/marketing-metadata";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

type TermsPageProps = {
  searchParams: LocaleSearchParams;
};

export async function generateMetadata({
  searchParams,
}: TermsPageProps): Promise<Metadata> {
  const locale = await getPageLocale(searchParams);

  return buildMarketingMetadata({
    locale,
    route: "terms",
    title: uiText(locale, "Terms", "AGB"),
    description: uiText(
      locale,
      "Terms for using the Deepglot service and WordPress integration.",
      "Bedingungen für die Nutzung des Deepglot-Dienstes und der WordPress-Integration."
    ),
  });
}

export default async function TermsPage({ searchParams }: TermsPageProps) {
  const locale = await getPageLocale(searchParams);

  return (
    <SimpleMarketingPage
      locale={locale}
      eyebrow={uiText(locale, "Legal", "Rechtliches")}
      title={uiText(locale, "Terms", "AGB")}
      description={
        uiText(
          locale,
          "These terms describe the current Deepglot SaaS, billing, quota, cancellation, and self-hosting flows. Last updated: 13 July 2026.",
          "Diese AGB beschreiben die aktuellen SaaS-, Abrechnungs-, Wortlimit-, Kündigungs- und Self-hosting-Abläufe von Deepglot. Stand: 13. Juli 2026."
        )
      }
      sections={[
        {
          title: uiText(locale, "1. Provider and scope", "1. Anbieter und Geltungsbereich"),
          body: uiText(
            locale,
            "The service is provided by Ostheimer OG, Fabriksgasse 20, 2230 Gänserndorf, Austria. These terms apply to Deepglot accounts, the hosted dashboard and translation API, and the associated WordPress plugin. Individual written agreements take precedence.",
            "Der Dienst wird von der Ostheimer OG, Fabriksgasse 20, 2230 Gänserndorf, Österreich, angeboten. Diese AGB gelten für Deepglot-Konten, das gehostete Dashboard, die Übersetzungs-API und das zugehörige WordPress-Plugin. Individuelle schriftliche Vereinbarungen gehen vor."
          ),
        },
        {
          title: uiText(locale, "2. Account and authorized use", "2. Konto und zulässige Nutzung"),
          body: uiText(
            locale,
            "You must provide accurate registration information, keep credentials and API keys secure, and use the service only for lawful content for which you hold the necessary rights. You are responsible for users, websites, webhook destinations, and provider credentials connected to your organization. Automated abuse, attempts to bypass quotas or rate limits, and interference with the service are prohibited.",
            "Du musst richtige Registrierungsangaben machen, Zugangsdaten und API-Schlüssel sicher verwahren und den Dienst nur für rechtmäßige Inhalte nutzen, für die du die erforderlichen Rechte besitzt. Du bist für Benutzer, Websites, Webhook-Ziele und Provider-Zugangsdaten deiner Organisation verantwortlich. Automatisierter Missbrauch, die Umgehung von Wortlimits oder Rate-Limits und Eingriffe in den Dienst sind untersagt."
          ),
        },
        {
          title: uiText(locale, "3. Service and translation results", "3. Dienst und Übersetzungsergebnisse"),
          body: uiText(
            locale,
            "Deepglot provides project configuration, translation caching, glossaries, import and export, webhooks, visual editing, and WordPress runtime integration. Machine translation can be incomplete or inaccurate. You must review translations before using them for legal, medical, safety-critical, regulated, or other high-risk purposes. We may maintain, update, or replace technical components while preserving the agreed core service.",
            "Deepglot bietet Projektkonfiguration, Übersetzungs-Cache, Glossare, Import und Export, Webhooks, visuelle Bearbeitung und WordPress-Laufzeitintegration. Maschinelle Übersetzungen können unvollständig oder fehlerhaft sein. Vor einer Nutzung für rechtliche, medizinische, sicherheitskritische, regulierte oder andere risikoreiche Zwecke musst du Übersetzungen fachlich prüfen. Wir dürfen technische Komponenten warten, aktualisieren oder ersetzen, solange der vereinbarte Kerndienst erhalten bleibt."
          ),
        },
        {
          title: uiText(locale, "4. Plans, prices, and Stripe billing", "4. Pläne, Preise und Stripe-Abrechnung"),
          body: uiText(
            locale,
            "The current plan scope, monthly or yearly billing interval, prices, taxes, and included limits are shown before purchase. Paid subscription checkout and payment management use Stripe. Paid subscriptions renew for the selected billing period until cancelled. Plan changes for an existing paid subscription are handled through the Stripe billing portal; Enterprise terms may be agreed separately. Invoices and payment-method data available through Stripe remain subject to Stripe's payment services.",
            "Der aktuelle Planumfang, das monatliche oder jährliche Abrechnungsintervall, Preise, Steuern und enthaltene Limits werden vor dem Kauf angezeigt. Checkout und Zahlungsverwaltung kostenpflichtiger Abonnements erfolgen über Stripe. Kostenpflichtige Abonnements verlängern sich um den gewählten Abrechnungszeitraum, bis sie gekündigt werden. Planwechsel eines bestehenden kostenpflichtigen Abonnements erfolgen über das Stripe-Abrechnungsportal; Enterprise-Bedingungen können gesondert vereinbart werden. Über Stripe verfügbare Rechnungen und Zahlungsmitteldaten unterliegen zusätzlich den Zahlungsdiensten von Stripe."
          ),
        },
        {
          title: uiText(locale, "5. Quotas and protective limits", "5. Wortlimits und Schutzgrenzen"),
          body: uiText(
            locale,
            "Every plan has finite project, language, and monthly word quotas. Fresh provider-billed translation words count toward the organization's applicable quota; cached or manual results may be served without a new provider call. When a quota is exhausted, new translations can be rejected until capacity becomes available or the plan changes. Per-minute and fresh-word velocity limits protect service availability and customer budgets. We may block abusive traffic or compromised credentials proportionately.",
            "Jeder Plan hat begrenzte Projekt-, Sprach- und monatliche Wortlimits. Frische, beim Übersetzungsanbieter abgerechnete Wörter zählen zum anwendbaren Limit der Organisation; Cache- oder manuelle Ergebnisse können ohne neuen Provider-Aufruf ausgeliefert werden. Ist ein Wortlimit ausgeschöpft, können neue Übersetzungen abgelehnt werden, bis wieder Kapazität verfügbar ist oder der Plan geändert wird. Anfrage- und Geschwindigkeitslimits für frische Wörter schützen Verfügbarkeit und Kundenbudgets. Missbräuchlichen Verkehr oder kompromittierte Zugangsdaten dürfen wir verhältnismäßig sperren."
          ),
        },
        {
          title: uiText(locale, "6. Cancellation and contract end", "6. Kündigung und Vertragsende"),
          body: uiText(
            locale,
            "You can cancel a paid subscription through the available cancellation control or Stripe billing portal. Cancellation is scheduled for the end of the current paid billing period; the paid plan normally remains active until then. Statutory cancellation, withdrawal, and refund rights remain unaffected. Cancelling a subscription does not itself delete the account or project data. Export required data before deleting a project or account and contact support if the in-product flow is unavailable.",
            "Du kannst ein kostenpflichtiges Abonnement über die vorhandene Kündigungsfunktion oder das Stripe-Abrechnungsportal kündigen. Die Kündigung wird zum Ende des laufenden bezahlten Abrechnungszeitraums wirksam; der bezahlte Plan bleibt grundsätzlich bis dahin aktiv. Gesetzliche Kündigungs-, Rücktritts-, Widerrufs- und Erstattungsrechte bleiben unberührt. Die Kündigung eines Abonnements löscht nicht automatisch das Konto oder Projektdaten. Exportiere benötigte Daten vor dem Löschen eines Projekts oder Kontos und kontaktiere den Support, falls die Produktfunktion nicht verfügbar ist."
          ),
        },
        {
          title: uiText(locale, "7. Customer content and providers", "7. Kundeninhalte und Provider"),
          body: uiText(
            locale,
            "You retain rights in content submitted to Deepglot and grant us the limited permission needed to process, store, translate, transmit, and return it for the service. Depending on project settings, translation content is sent to the selected translation provider or customer-specified compatible endpoint. You must ensure that this processing and any uploaded provider API key are permitted for your content and users.",
            "Du behältst die Rechte an den an Deepglot übermittelten Inhalten und räumst uns die für den Dienst erforderliche beschränkte Berechtigung ein, diese zu verarbeiten, zu speichern, zu übersetzen, zu übertragen und zurückzugeben. Je nach Projekteinstellung werden Übersetzungsinhalte an den gewählten Übersetzungsanbieter oder einen kundenseitig festgelegten kompatiblen Endpoint gesendet. Du musst sicherstellen, dass diese Verarbeitung und jeder hinterlegte Provider-API-Schlüssel für deine Inhalte und Benutzer zulässig sind."
          ),
        },
        {
          title: uiText(locale, "8. Self-hosting", "8. Self-hosting"),
          body: uiText(
            locale,
            "Deepglot supports a self-hosted deployment path to reduce cloud lock-in. Unless a separate managed-services agreement applies, the self-hosting operator is responsible for infrastructure, database, backups, security updates, email, payment and translation-provider configuration, lawful processing, and third-party charges. Availability or support for third-party and self-hosted systems is not part of the hosted subscription merely because integration documentation is provided.",
            "Deepglot unterstützt einen selbst gehosteten Bereitstellungsweg, um Cloud-Lock-in zu reduzieren. Soweit keine gesonderte Managed-Services-Vereinbarung besteht, ist der Self-hosting-Betreiber für Infrastruktur, Datenbank, Backups, Sicherheitsupdates, E-Mail-, Zahlungs- und Übersetzungsanbieter-Konfiguration, rechtmäßige Verarbeitung und Drittanbieterkosten verantwortlich. Verfügbarkeit oder Support für Drittanbieter- und selbst gehostete Systeme sind nicht allein deshalb Teil des gehosteten Abonnements, weil Integrationsdokumentation bereitgestellt wird."
          ),
        },
        {
          title: uiText(locale, "9. Availability, warranty, and liability", "9. Verfügbarkeit, Gewährleistung und Haftung"),
          body: uiText(
            locale,
            "We use reasonable care to operate the service but do not promise uninterrupted availability or error-free translation results. Planned maintenance, security measures, provider failures, and events outside our reasonable control may affect operation. Mandatory warranty and liability rules, including liability that cannot legally be limited, remain unaffected; any further limitation requires owner and legal review for the applicable customer group.",
            "Wir betreiben den Dienst mit angemessener Sorgfalt, versprechen jedoch keine unterbrechungsfreie Verfügbarkeit oder fehlerfreie Übersetzungsergebnisse. Geplante Wartung, Sicherheitsmaßnahmen, Provider-Ausfälle und Ereignisse außerhalb unseres zumutbaren Einflusses können den Betrieb beeinträchtigen. Zwingende Gewährleistungs- und Haftungsbestimmungen, einschließlich gesetzlich nicht beschränkbarer Haftung, bleiben unberührt; jede weitergehende Beschränkung bedarf der Prüfung für die jeweilige Kundengruppe."
          ),
        },
        {
          title: uiText(locale, "10. Changes and applicable law", "10. Änderungen und anwendbares Recht"),
          body: uiText(
            locale,
            "We may update these terms when the product, law, or processing changes. Material changes will be communicated in an appropriate form before they take effect. Austrian law applies without depriving consumers of mandatory protections in their country of residence. Mandatory consumer jurisdiction rules remain unaffected.",
            "Wir dürfen diese AGB anpassen, wenn sich Produkt, Rechtslage oder Verarbeitung ändern. Wesentliche Änderungen werden vor ihrem Inkrafttreten in geeigneter Form mitgeteilt. Es gilt österreichisches Recht, ohne Verbrauchern zwingende Schutzvorschriften ihres Wohnsitzstaates zu entziehen. Zwingende Verbrauchergerichtsstände bleiben unberührt."
          ),
        },
        {
          title: uiText(locale, "11. Contact", "11. Kontakt"),
          body: uiText(
            locale,
            "Questions about the service or these terms can be sent to office@ostheimer.at or addressed to Ostheimer OG, Fabriksgasse 20, 2230 Gänserndorf, Austria.",
            "Fragen zum Dienst oder zu diesen AGB kannst du an office@ostheimer.at oder an Ostheimer OG, Fabriksgasse 20, 2230 Gänserndorf, Österreich, richten."
          ),
        },
      ]}
    />
  );
}
