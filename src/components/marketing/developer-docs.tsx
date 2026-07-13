import Link from "next/link";

import { MarketingNav } from "@/components/marketing/marketing-nav";
import {
  DASHBOARD_DEVELOPER_SURFACES,
  PROBLEM_DETAILS_EXAMPLE,
  PROJECT_WEBHOOK_DOC_EVENTS,
  PUBLIC_ENDPOINT_DOCS,
  WORDPRESS_REST_ENDPOINTS,
  docsText,
} from "@/lib/public-docs";
import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-gray-950 p-4 text-sm leading-6 text-gray-100">
      <code>{children}</code>
    </pre>
  );
}

export function DeveloperDocs({ locale }: { locale: SiteLocale }) {
  const de = locale === "de";

  return (
    <div className="min-h-screen bg-white text-gray-950">
      <MarketingNav locale={locale} active="docs" />
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            {de ? "Entwicklerdokumentation" : "Developer documentation"}
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            {de ? "Deepglot integrieren" : "Integrate Deepglot"}
          </h1>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            {de
              ? "Source-basierte Referenz für WordPress, REST-API, Authentifizierung, Fehler, Webhooks und sichere Projektabläufe."
              : "Source-backed reference for WordPress, the REST API, authentication, errors, webhooks, and safe project workflows."}
          </p>
        </div>

        <nav aria-label={de ? "Dokumentationsbereiche" : "Documentation sections"} className="mt-10 flex flex-wrap gap-3 text-sm">
          {[
            ["quickstart", de ? "Schnellstart" : "Quickstart"],
            ["api-reference", de ? "API-Referenz" : "API reference"],
            ["wordpress", "WordPress"],
            ["errors", de ? "Fehler und Wiederholungen" : "Errors and retries"],
            ["webhooks", "Webhooks"],
            ["project-surfaces", de ? "Projektoberflächen" : "Project surfaces"],
            ["versioning", de ? "Versionierung" : "Versioning"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-full border border-gray-300 px-4 py-2 font-medium hover:border-indigo-500 hover:text-indigo-700">
              {label}
            </a>
          ))}
        </nav>

        <section id="quickstart" className="scroll-mt-8 pt-20">
          <h2 className="text-3xl font-bold">{de ? "Schnellstart" : "Quickstart"}</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-2">
            {[
              de ? "Konto erstellen und im Dashboard ein Projekt mit Quell- und Zielsprachen anlegen." : "Create an account and a dashboard project with source and target languages.",
              de ? "Einen Projekt-API-Key erstellen. Der Klartext wird nur einmal angezeigt und gehört nicht in Browser-Code." : "Create a project API key. Its plaintext is shown once and must not be embedded in browser code.",
              de ? "Das WordPress-Plugin installieren, API-URL und Key eintragen und den Verbindungstest ausführen." : "Install the WordPress plugin, enter the API URL and key, and run the connection test.",
              de ? "Eine übersetzte URL öffnen und Navigation, hreflang, Cache, dynamische Inhalte und Kontingentstatus prüfen." : "Open a translated URL and verify navigation, hreflang, cache, dynamic content, and quota status.",
            ].map((step, index) => (
              <li key={step} className="rounded-2xl border border-gray-200 p-5 leading-7 text-gray-700">
                <span className="mr-2 font-mono font-semibold text-indigo-600">{index + 1}.</span>{step}
              </li>
            ))}
          </ol>
          <div className="mt-6 rounded-2xl bg-indigo-50 p-6 text-sm leading-7 text-indigo-950">
            <strong>{de ? "Authentifizierung:" : "Authentication:"}</strong>{" "}
            {de
              ? "Nutze bevorzugt Authorization: Bearer <key>. ?api_key=<key> bleibt für ältere Plugin-Clients kompatibel. Dashboard-Routen verwenden dagegen eine angemeldete Sitzung und sind keine öffentliche API."
              : "Prefer Authorization: Bearer <key>. ?api_key=<key> remains compatible with legacy plugin clients. Dashboard routes use a signed-in session and are not a public API."}
          </div>
        </section>

        <section id="api-reference" className="scroll-mt-8 pt-20">
          <h2 className="text-3xl font-bold">{de ? "API-Referenz" : "API reference"}</h2>
          <div className="mt-8 space-y-8">
            {PUBLIC_ENDPOINT_DOCS.map((endpoint) => (
              <article key={endpoint.id} className="rounded-2xl border border-gray-200 p-6 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-md bg-gray-950 px-2.5 py-1 font-mono text-xs font-bold text-white">{endpoint.method}</span>
                  <h3 className="font-mono text-lg font-semibold">{endpoint.path}</h3>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">{endpoint.audience}</span>
                </div>
                <p className="mt-4 leading-7 text-gray-700">{docsText(locale, endpoint.summary)}</p>
                <p className="mt-3 text-sm text-gray-600"><strong>Auth:</strong> {docsText(locale, endpoint.auth)}</p>
                <p className="mt-2 text-xs text-gray-500">
                  {de ? "Quellcode:" : "Source:"}{" "}
                  <a
                    className="font-mono text-indigo-600 hover:underline"
                    href={`https://github.com/ostheimer/deepglot/blob/main/${endpoint.sourceFile}`}
                  >
                    {endpoint.sourceFile}
                  </a>
                </p>
                {endpoint.requestExample && <div className="mt-5"><p className="mb-2 text-sm font-semibold">{de ? "Anfrage" : "Request"}</p><CodeBlock>{endpoint.requestExample}</CodeBlock></div>}
                {endpoint.responseExample && <div className="mt-5"><p className="mb-2 text-sm font-semibold">{de ? "Antwort" : "Response"}</p><CodeBlock>{endpoint.responseExample}</CodeBlock></div>}
                {endpoint.notes.length > 0 && (
                  <ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-6 text-gray-600">
                    {endpoint.notes.map((note) => <li key={note.en}>{docsText(locale, note)}</li>)}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>

        <section id="wordpress" className="scroll-mt-8 pt-20">
          <h2 className="text-3xl font-bold">WordPress</h2>
          <p className="mt-5 max-w-4xl leading-7 text-gray-700">
            {de
              ? "Die Plugin-REST-Routen laufen auf der WordPress-Site und benötigen WordPress-Administratorrechte. Die dynamische Übersetzung verwendet Nonce, kurzlebiges Wortticket, per-IP-Budget und den serverseitigen Organisations-Cap. Fehlende Berechtigung fällt cachebasiert zurück; Bots lösen keine neue Übersetzung aus."
              : "Plugin REST routes run on the WordPress site and require WordPress administrator permissions. Dynamic translation uses a nonce, short-lived word ticket, per-IP budget, and the server-side organization cap. Missing authorization degrades to cache-only behavior; bots never trigger fresh translation."}
          </p>
          <p className="mt-3 max-w-4xl leading-7 text-gray-700">
            {de
              ? "Ein universelles JavaScript-Snippet und ein Reverse Proxy sind derzeit nicht verfügbar. WordPress ist der einzige unterstützte Integrationsweg."
              : "A Universal JavaScript snippet and reverse proxy are not currently available. WordPress is the only supported integration path."}
          </p>
          <p className="mt-3 max-w-4xl leading-7 text-gray-700">
            {de
              ? "AMP-Seiten durchlaufen die Übersetzung nur bei aktivierter Plugin-Option. Die mehrsprachige Sitemap unter /deepglot-sitemap.xml wird in robots.txt angekündigt und enthält ausschließlich validierte interne Sprachalternativen."
              : "AMP pages enter the translation pipeline only when the plugin option is enabled. The multilingual sitemap at /deepglot-sitemap.xml is advertised in robots.txt and contains only validated internal language alternatives."}
          </p>
          <ul className="mt-6 grid gap-3 font-mono text-sm md:grid-cols-2">
            {WORDPRESS_REST_ENDPOINTS.map((endpoint) => <li key={endpoint} className="rounded-xl bg-gray-100 px-4 py-3">{endpoint}</li>)}
          </ul>
        </section>

        <section id="errors" className="scroll-mt-8 pt-20">
          <h2 className="text-3xl font-bold">{de ? "Fehler und Wiederholungen" : "Errors and retries"}</h2>
          <p className="mt-5 leading-7 text-gray-700">
            {de
              ? "Öffentliche und Plugin-Routen verwenden einen Problem-Details-artigen JSON-Vertrag. error bleibt als Legacy-Alias für bestehende Plugin-Versionen erhalten. Clients sollen code und status auswerten; detail ist für Menschen."
              : "Public and plugin routes use a Problem Details-style JSON contract. error remains as a legacy alias for existing plugin versions. Clients should branch on code and status; detail is human-readable."}
          </p>
          <div className="mt-5"><CodeBlock>{PROBLEM_DETAILS_EXAMPLE}</CodeBlock></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {["400 validation_failed", "401 missing_api_key / invalid_api_key", "402 quota_exhausted", "409 idempotency_conflict", "429 rate_limit_exceeded / velocity_limited", "500 internal_error", "503 service_unavailable"].map((item) => (
              <div key={item} className="rounded-xl border border-gray-200 px-4 py-3 font-mono text-xs">{item}</div>
            ))}
          </div>
        </section>

        <section id="webhooks" className="scroll-mt-8 pt-20">
          <h2 className="text-3xl font-bold">Webhooks</h2>
          <p className="mt-5 leading-7 text-gray-700">
            {de
              ? "Verwaltende Projektmitglieder konfigurieren öffentliche HTTPS-Ziele. Deepglot prüft Ziele bei Anlage und Versand gegen SSRF, signiert timestamp.payload mit HMAC-SHA256 und sendet X-Deepglot-Event, X-Deepglot-Timestamp und X-Deepglot-Signature. Fehlversuche werden nach 60, 300 und 900 Sekunden wiederholt."
              : "Project managers configure public HTTPS targets. Deepglot checks targets for SSRF at creation and dispatch, signs timestamp.payload with HMAC-SHA256, and sends X-Deepglot-Event, X-Deepglot-Timestamp, and X-Deepglot-Signature. Failed deliveries retry after 60, 300, and 900 seconds."}
          </p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PROJECT_WEBHOOK_DOC_EVENTS.map((event) => <li key={event} className="rounded-xl bg-gray-100 px-4 py-3 font-mono text-sm">{event}</li>)}
          </ul>
        </section>

        <section id="project-surfaces" className="scroll-mt-8 pt-20">
          <h2 className="text-3xl font-bold">{de ? "Projektoberflächen" : "Project surfaces"}</h2>
          <p className="mt-5 leading-7 text-gray-700">
            {de
              ? "Diese Routen versorgen das Dashboard und sind nicht als externer stabiler REST-Vertrag freigegeben. API-Keys, Sprachen, Webhooks, Ausschlüsse und das Pro+-Übersetzungsgedächtnis benötigen Verwaltungsrechte. Menschliche Prüfungen und PDF-Übersetzungen sind zusätzlich projekt- und sprachgebunden; nur Verwaltende dürfen zuweisen oder freigeben. Glossar-CRUD verwendet derzeit die schwächere Projektmitgliedschaftsprüfung. Import, Export und Editor-Sitzungen verwenden angemeldete, projektspezifische Zugriffe."
              : "These routes power the dashboard and are not a stable external REST contract. API keys, languages, webhooks, exclusions, and the Pro+ translation-memory setting require management access. Human review and PDF translation are additionally project- and language-scoped; only managers may assign or approve. Glossary CRUD currently uses the weaker project-membership gate. Import, export, and editor sessions use signed-in, project-specific access."}
          </p>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-gray-200">
            <table className="w-full text-left text-sm"><thead className="bg-gray-50"><tr><th className="px-4 py-3">Route</th><th className="px-4 py-3">Access</th></tr></thead><tbody>
              {DASHBOARD_DEVELOPER_SURFACES.map((surface) => <tr key={surface.path} className="border-t border-gray-200"><td className="px-4 py-3 font-mono">{surface.path}</td><td className="px-4 py-3">{surface.access}</td></tr>)}
            </tbody></table>
          </div>
        </section>

        <section id="versioning" className="scroll-mt-8 pt-20">
          <h2 className="text-3xl font-bold">{de ? "Sprachen, Versionierung und Support" : "Languages, versioning, and support"}</h2>
          <div className="mt-6 space-y-4 leading-7 text-gray-700">
            <p>{de ? "Der Sprachkatalog aus /api/public/languages ist kanonisch. sharedAcrossProviders=false bedeutet: im Produkt unterstützt, aber nicht von jedem auswählbaren Anbieter garantiert." : "The /api/public/languages catalog is canonical. sharedAcrossProviders=false means supported by the product but not guaranteed by every selectable provider."}</p>
            <p>{de ? "Die aktuelle öffentliche API ist unversioniert. Rückwärtskompatible Felder werden ergänzt; brechende Änderungen benötigen einen versionierten Pfad oder eine angekündigte Übergangsfrist von mindestens 90 Tagen. Plugin-Versionen und Produktionsänderungen stehen in GitHub Releases, ROADMAP.md und HANDOFF.md." : "The current public API is unversioned. Backward-compatible fields may be added; breaking changes require a versioned path or an announced deprecation window of at least 90 days. Plugin versions and production behavior changes are recorded in GitHub Releases, ROADMAP.md, and HANDOFF.md."}</p>
            <p>
              {de ? "MCP-Server, offizielles SDK/CLI und Agent-Skills sind derzeit nicht verfügbar. DPP-Lokalisierung ist eine spätere, noch zu validierende Richtung und keine Compliance-Zusage. " : "An MCP server, official SDK/CLI, and agent skills are not currently available. DPP localization is a later, unvalidated direction and not a compliance claim. "}
              <a
                className="font-medium text-indigo-600 hover:underline"
                href="https://github.com/ostheimer/deepglot/blob/main/docs/product-decisions/developer-surfaces.md"
              >
                {de ? "Entscheidungsprotokoll" : "Decision record"}
              </a>
            </p>
          </div>
        </section>

        <div className="mt-20 rounded-2xl bg-gray-50 p-6 text-sm text-gray-600">
          {de ? "Fragen oder Integrationsfeedback? " : "Questions or integration feedback? "}<a className="font-medium text-indigo-600 hover:underline" href="mailto:office@ostheimer.at">office@ostheimer.at</a>
          <span className="mx-2">·</span><Link className="font-medium text-indigo-600 hover:underline" href={getMarketingPath(locale, "home")}>{de ? "Zur Startseite" : "Back to homepage"}</Link>
        </div>
      </main>
    </div>
  );
}
