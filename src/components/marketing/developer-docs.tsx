import Link from "next/link";

import { MarketingFooter } from "@/components/marketing/marketing-footer";
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
    <pre className="max-w-full overflow-x-auto rounded-md border border-white/10 bg-[#071521] p-4 text-sm leading-6 text-white/90">
      <code>{children}</code>
    </pre>
  );
}

export function DeveloperDocs({ locale }: { locale: SiteLocale }) {
  const de = locale === "de";

  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#071521]">
      <MarketingNav locale={locale} active="docs" />
      <main>
        <header className="border-b border-[#d8d6ce] bg-[#071521] text-white">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
            <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#f03b22]">
            {de ? "Entwicklerdokumentation" : "Developer documentation"}
          </p>
          <h1 className="mt-4 text-5xl font-extrabold tracking-[-0.05em] sm:text-6xl">
            {de ? "Deepglot integrieren" : "Integrate Deepglot"}
          </h1>
          <p className="mt-6 text-lg leading-8 text-white/65">
            {de
              ? "Source-basierte Referenz für WordPress, REST-API, Authentifizierung, Fehler, Webhooks und sichere Projektabläufe."
              : "Source-backed reference for WordPress, the REST API, authentication, errors, webhooks, and safe project workflows."}
          </p>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">

        <nav aria-label={de ? "Dokumentationsbereiche" : "Documentation sections"} className="mt-10 flex flex-wrap gap-3 text-sm">
          {[
            ["quickstart", de ? "Schnellstart" : "Quickstart"],
            ["api-reference", de ? "API-Referenz" : "API reference"],
            ["wordpress", "WordPress"],
            ["wordpress-operations", de ? "Betriebshilfe" : "Operations help"],
            ["activity-digest", de ? "Wochenrückblick" : "Weekly digest"],
            ["wordpress-releases", de ? "Plugin-Releases" : "Plugin releases"],
            ["errors", de ? "Fehler und Wiederholungen" : "Errors and retries"],
            ["webhooks", "Webhooks"],
            ["project-surfaces", de ? "Projektoberflächen" : "Project surfaces"],
            ["versioning", de ? "Versionierung" : "Versioning"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-md border border-[#c9c7be] bg-white px-4 py-2 font-semibold transition-colors hover:border-[#f03b22] hover:text-[#d92f19]">
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
              <li key={step} className="border-l-2 border-[#f03b22] bg-white p-5 leading-7 text-[#4d5963]">
                <span className="mr-2 font-mono font-semibold text-[#c62812]">{index + 1}.</span>{step}
              </li>
            ))}
          </ol>
          <div className="mt-6 rounded-2xl bg-[#fff0ec] p-6 text-sm leading-7 text-[#5e1f14]">
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
              <article key={endpoint.id} className="min-w-0 rounded-md border border-[#d8d6ce] bg-white p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-md bg-gray-950 px-2.5 py-1 font-mono text-xs font-bold text-white">{endpoint.method}</span>
                  <h3 className="min-w-0 font-mono text-lg font-semibold max-[350px]:[overflow-wrap:anywhere]">{endpoint.path}</h3>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">{endpoint.audience}</span>
                </div>
                <p className="mt-4 leading-7 text-gray-700">{docsText(locale, endpoint.summary)}</p>
                <p className="mt-3 text-sm text-gray-600"><strong>Auth:</strong> {docsText(locale, endpoint.auth)}</p>
                <p className="mt-2 text-xs text-gray-500">
                  {de ? "Quellcode:" : "Source:"}{" "}
                  <a
                    className="font-mono text-[#c62812] hover:underline"
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
          <p className="mt-3 max-w-4xl leading-7 text-gray-700">
            {de
              ? "Ab Version 0.12.0 wartet ein normaler Seitenaufruf standardmäßig nicht auf neue Übersetzungen. Fehlende Segmente werden in einer begrenzten, deduplizierten Warteschlange gesammelt und durch WP-Cron übersetzt. Kann ein kalter Aufruf Text und Cache-Ziel wegen einer kurzen Sperre nicht gemeinsam speichern, wird seine Quelltext-Antwort nicht gecacht und ein späterer Aufruf kann es erneut versuchen. Visueller Editor und WooCommerce-E-Mails bleiben synchron, weil diese Ausgaben nicht bei einem späteren Aufruf automatisch konvergieren."
              : "From version 0.12.0, an ordinary page request does not wait for fresh translations by default. Missing segments enter a bounded, deduplicated queue and are translated by WP-Cron. If a cold request cannot store both its text and cache target because the short queue lock is busy, its source-language response is not cached and a later request can retry. The visual editor and WooCommerce emails remain synchronous because those outputs cannot converge automatically on a later request."}
          </p>
          <p className="mt-3 max-w-4xl leading-7 text-gray-700">
            {de
              ? "Administratoren können unter Einstellungen → Deepglot eine begrenzte URL-Synchronisierung aus der Deepglot-Sitemap starten. Vor dem Start ist eine nebenwirkungsfreie Vorschau mit festem Snapshot und Beispiel-URLs zu bestätigen. Erkennt WordPress eine sichere HTTPS-Anfrage auf demselben Host wie eine noch mit HTTP gespeicherte interne Ziel-URL, verwendet der Snapshot dieselbe interne Ziel-URL mit HTTPS. Semantische Query-Parameter und Fragmente bleiben erhalten. Ein fremder Request-Host wird niemals übernommen. Eine absolute, query- und fragmentfreie Weiterleitung auf exakt derselben Origin und in derselben Zielsprache wird mit getrennten öffentlichen und Origin-Prüfungen explizit verifiziert; automatisches Folgen bleibt deaktiviert. Andere Weiterleitungen bleiben begrenzte Fehler. Jeder Batch umfasst höchstens 250 Zielseiten, füllt kontrolliert dieselbe Übersetzungswarteschlange und lässt sich pausieren, fortsetzen oder abbrechen. Es gibt keinen permanenten Hintergrundcrawler."
              : "Administrators can start a bounded URL synchronization from the Deepglot sitemap under Settings → Deepglot. A side-effect-free preview with an immutable snapshot and sample URLs must be confirmed before it starts. When WordPress recognizes a safe HTTPS request on the same host as an internal target still stored with HTTP, the snapshot uses the same internal target with HTTPS. Semantic query parameters and fragments are preserved. A foreign request host is never copied. One absolute, query- and fragment-free redirect on the exact same origin and in the requested target language is verified explicitly through separate public and origin probes; automatic redirect following remains disabled. Other redirects remain bounded failures. Each batch contains at most 250 target pages, feeds the same translation queue at a controlled rate, and can be paused, resumed, or cancelled. It is not a permanent background crawler."}
          </p>
          <ul className="mt-6 grid gap-3 font-mono text-sm md:grid-cols-2">
            {WORDPRESS_REST_ENDPOINTS.map((endpoint) => <li key={endpoint} className="rounded-md border border-[#d8d6ce] bg-white px-4 py-3">{endpoint}</li>)}
          </ul>
        </section>

        <section id="wordpress-operations" className="scroll-mt-8 pt-20">
          <h2 className="text-3xl font-bold">{de ? "WordPress-Betriebshilfe" : "WordPress operations help"}</h2>
          <p className="mt-5 max-w-4xl leading-7 text-gray-700">
            {de
              ? "Der erste Aufruf einer noch nicht übersetzten Seite kann bewusst den Quelltext zeigen. Er legt die fehlenden Segmente in die Warm-up-Warteschlange; ein sofort fälliges WP-Cron-Ereignis verarbeitet sie im Hintergrund. Sobald Warteschlange und Ereignis gespeichert sind, stößt Deepglot pro Anfrage einmal nicht blockierend WP-Cron an. Bei DISABLE_WP_CRON oder während eines Cron-Laufs bleibt dieser Anstoß aus. Nach erfolgreichem Abschluss löscht Deepglot betroffene Seiten aus unterstützten Full-Page-Caches, damit der nächste Aufruf die lokal gespeicherte Übersetzung erhält."
              : "The first request for a page without cached translations can intentionally show source content. It places missing segments in the warm-up queue, and an immediately due WP-Cron event processes them in the background. Once the queue and event are stored, Deepglot makes one non-blocking WP-Cron nudge per request. That nudge is skipped for DISABLE_WP_CRON and while cron is already running. After success, Deepglot purges affected pages from supported full-page caches so the next request receives the locally cached translation."}
          </p>
          <p className="mt-3 max-w-4xl leading-7 text-gray-700">
            {de
              ? "Nur Translation-429-Antworten setzen den aktiven Marker. Marker und Warmer-Wartezustand sind an API-Schlüssel und Backend gebunden; Konfigurationswechsel, verspätete Antworten der alten Konfiguration und alte ungebundene Marker blockieren keine neuen Übersetzungen."
              : "Only translation 429 responses set the active marker. The marker and warmer backoff are bound to the API key and backend; configuration changes, late responses from the previous configuration, and legacy or unbound markers do not block new translations."}
          </p>
          <p className="mt-3 max-w-4xl leading-7 text-gray-700">
            {de
              ? "Melden alle versuchten Anbieter für denselben mehrteiligen Ausgangsstapel ausschließlich eine Abweichung bei der Ergebnisanzahl, startet Deepglot eine direkte Einzeltext-Isolierung. Redundante binäre Zwischenstufen entfallen; jeder ursprüngliche Text durchläuft die konfigurierte Anbieterkette in seiner Eingabereihenfolge. Für einen mehrteiligen Ausgangsstapel lautet die Anbieteraufrufgrenze Kettenlänge × (Stapelgröße + 1); ein ursprünglicher Einzeltext durchläuft die Kette einmal. Beim Standardfall mit acht Texten und zwei Anbietern sind das höchstens 18 Anbieteraufrufe. Alle Ausgangsstapel und isolierten Einzeltexte teilen sich die anfrageweite Parallelitätsgrenze von standardmäßig 12 und eine gemeinsame Anbieterarbeitsfrist von höchstens 100 Sekunden. Bei PDF-Übersetzungen beginnt am Routeneintritt ein eigenes Budget von 40 Sekunden; Authentifizierung, Multipart-Verarbeitung und PDF-Vorbereitung werden davon abgezogen, damit für Abschlussarbeiten der 60-Sekunden-Route nominell 20 Sekunden bleiben. Fehler eines parallelen Stapels stoppen neue Anbieteraufrufe von Geschwistern. Abweichungen bei einem Einzeltext sowie am Aufruf- oder Zeitlimit bleiben endgültige Fehler; Zeitüberschreitungen, Authentifizierungsfehler, Ratenlimits, U+0000 und andere ungültige Antworten lösen diese Zusatzanfragen nicht aus."
              : "When every attempted provider reports only a count mismatch for the same multi-text root chunk, Deepglot starts direct singleton isolation. It skips redundant binary intermediate shapes and retries each original text through the configured provider chain in input order. The provider-call ceiling is chain length × (chunk size + 1) for a multi-text root, while an original singleton gets one chain; a default eight-text chunk with two providers therefore allows at most 18 provider calls. All root chunks and isolated singletons share the request-wide provider-call concurrency cap (default 12) and a provider-work deadline of at most 100 seconds. PDF translation uses a separate 40-second budget from route entry; authentication, multipart handling, and PDF preparation reduce the remaining provider time so the 60-second route nominally retains 20 seconds for completion work. A failing parallel chunk stops new sibling provider calls. Singleton, call-budget, and deadline mismatches remain terminal; timeouts, authentication failures, rate limits, U+0000, and other malformed responses never trigger these extra requests."}
          </p>
          <p className="mt-3 max-w-4xl leading-7 text-gray-700 max-[350px]:[overflow-wrap:anywhere]">
            {de
              ? "Deepglot wertet alle begrenzten Ausgangsstapel aus, bevor Einzeltextaufrufe beginnen. Gesammelt werden nur Ausgangsstapel, deren vollständige Anbieterkette ausschließlich Abweichungen bei der Ergebnisanzahl geliefert hat; jeder andere endgültige Fehler bricht Geschwister weiterhin sofort ab. Vor dem Start der Kalibrierung vergleicht Deepglot die Restfrist mit einer konservativen Reserve für eine Welle: der kürzesten gemessenen Gesamtdauer unter den vollständig abgeschlossenen Ausgangsketten mit reinen Ergebnisanzahl-Abweichungen. Passt diese Reserve nicht, beginnt kein Einzeltext-Anbieteraufruf. Diese aus Ausgangsstapeln abgeleitete Reserve dient nur der Zulassung der Kalibrierung und wird nie auf spätere Arbeit hochgerechnet. Danach führt Deepglot genau eine globale Kalibrierungswelle mit den ersten min(anfrageweite Parallelität, Anzahl abweichender Texte) echten Einzeltexten durch die vollständige Anbieter-Fallbackkette aus und übernimmt deren Ergebnisse. Läuft die gemeinsame Frist trotz der Zulassungsprüfungen während einer bereits zugelassenen Einzeltextwelle ab, gibt Deepglot denselben typisierten Fristfehler statt einer allgemeinen Zeitüberschreitung zurück. Die verbleibende Arbeit wird in anfrageweit begrenzte Wellen geteilt. Vor jeder späteren Welle vergleicht Deepglot Anzahl noch ausstehender Wellen × gemessene Dauer der unmittelbar vorherigen Einzeltextwelle mit der verbleibenden gemeinsamen Frist und misst nach jeder abgeschlossenen Welle neu. Maßgeblich ist die frühere Frist aus lokaler Anbieterarbeitsgrenze und monotoner absoluter Aufruferfrist; die PDF-Route übergibt ihre beim Routeneintritt beginnende 40-Sekunden-Frist, sodass Authentifizierung, Upload-Verarbeitung und Vorbereitung dasselbe Budget verbrauchen. Passt die ausstehende Arbeit nicht mehr, endet die Anfrage nach der letzten übernommenen Welle und vor jedem weiteren Einzeltextaufruf. API und PDF antworten mit dem stabilen 503-Code „translation_count_mismatch_deadline“; ab dem ersten Anbieteraufruf behält die API ihre Geschwindigkeitslimit-Reservierung konservativ bei und speichert eine idempotente 503-Antwort für denselben Schlüssel höchstens 60 Sekunden. Andernfalls laufen die verbleibenden betroffenen Texte durch dieselbe global begrenzte Einzeltextwarteschlange; Ergebnisreihenfolge und vollständige Anbieter-Fallbackkette bleiben erhalten."
              : "Deepglot finishes all bounded root-chunk attempts before starting singleton work. It collects only roots whose complete provider chains produced count mismatches; any other terminal error still aborts siblings immediately. Before calibration, Deepglot compares the remaining deadline with a conservative one-wave reserve: the fastest elapsed duration among the completed full count-mismatch root chains. If that reserve cannot fit, no singleton provider call starts. This root-derived reserve is used only for calibration admission and is never extrapolated across later work. It then runs exactly one global calibration wave containing the first min(request-wide concurrency, total mismatched texts) real singletons through their full provider fallback chains and retains its results. If the shared deadline expires during any admitted singleton wave despite the admission checks, Deepglot returns the same typed deadline error instead of a generic timeout. The remaining work is split into request-wide bounded waves. Before each later wave, Deepglot compares waves still pending × duration of the immediately preceding observed singleton wave with the remaining shared deadline and remeasures after every completed wave. That deadline is the earlier of the local provider-work ceiling and the caller's monotonic absolute deadline; the PDF route passes its route-entry 40-second deadline so authentication, upload handling, and preparation consume the same budget. If the pending work cannot fit, the request stops after the last retained wave and before any further singleton call. API and PDF return the stable 503 code ‘translation_count_mismatch_deadline’; once the first provider call starts, the API conservatively retains its velocity reservation and retains an idempotent same-key 503 for at most 60 seconds. Otherwise, the remaining affected texts continue through the same globally bounded singleton queue, preserving result order and each text's full provider fallback chain."}
          </p>
          <p className="mt-3 max-w-4xl leading-7 text-gray-700">
            {de
              ? "Die lokalisierte öffentliche Anfrage-URL bleibt dabei das Cache-Ziel, auch nachdem der Request-Router intern auf den Quellpfad umgeschrieben hat."
              : "The localized public request URL remains the cache target even after the request router internally rewrites it to the source path."}
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              {
                title: de ? "1. URLs synchronisieren" : "1. Synchronize URLs",
                body: de
                  ? "Erstelle in den Deepglot-Einstellungen zunächst eine kleine URL-Vorschau und bestätige den unveränderlichen Snapshot. Prüfe, dass ein veraltetes HTTP-Ziel auf demselben sicheren Host mit HTTPS erscheint und dass semantische Query-Parameter erhalten bleiben. Der Lauf verwendet nur interne Sitemap-Ziele, zeigt den aggregierten Fortschritt, pausiert bei vollem Kontingent oder ungültigem API-Key und wartet bei API-Ratenlimits automatisch. Einzelne Seiten können weiterhin durch einen normalen menschlichen Aufruf angestoßen werden."
                  : "Create a small URL preview in the Deepglot settings first, then confirm the immutable snapshot. Verify that a stale HTTP target on the same safe host appears with HTTPS and that semantic query parameters are preserved. The job uses only internal sitemap targets, reports aggregate progress, pauses on exhausted quota or an invalid API key, and automatically backs off on API rate limits. Individual pages can still be triggered by an ordinary human visit.",
              },
              {
                title: de ? "2. WP-Cron prüfen" : "2. Check WP-Cron",
                body: de
                  ? "Wenn die Seite im Quelltext bleibt, prüfe, ob WP-Cron oder der konfigurierte System-Cron läuft. Hosts mit DISABLE_WP_CRON benötigen einen eigenen Cron-Aufruf."
                  : "If the page stays in the source language, verify WP-Cron or the configured system cron is running. Hosts with DISABLE_WP_CRON need their own cron invocation.",
              },
              {
                title: de ? "3. Seiten-Cache prüfen" : "3. Check page caches",
                body: de
                  ? "Der Status ‚Abgeschlossen‘ bestätigt die abgearbeitete Warteschlange am WordPress-Ursprung, nicht die öffentliche Cache-Ausgabe. WP Rocket, W3 Total Cache und LiteSpeed Cache leeren fertige URLs einzeln. WP Super Cache wird global erst geleert, wenn die verfolgte URL-Warteschlange leer ist; ausstehende Seiten bleiben bis dahin gecacht. Bei anderen Full-Page-Caches leere den Seiten-Cache manuell, behalte den Deepglot-Übersetzungs-Cache und prüfe die Zielsprachseite anschließend ohne Sync-Parameter."
                  : "The completed status confirms the processed queue at the WordPress origin, not the public page-cache response. WP Rocket, W3 Total Cache, and LiteSpeed Cache purge completed URLs individually. WP Super Cache is purged globally only when the tracked URL queue is empty, so pending pages remain cached. For other full-page caches, purge the page cache manually, keep Deepglot's translation cache, and then verify the target-language page without sync parameters.",
              },
            ].map((item) => (
              <article key={item.title} className="rounded-md border border-[#d8d6ce] bg-white p-5">
                <h3 className="font-semibold text-[#071521]">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-gray-600">{item.body}</p>
              </article>
            ))}
          </div>
          <div className="mt-6 rounded-2xl bg-[#fff0ec] p-6 text-sm leading-7 text-[#5e1f14]">
            <strong>{de ? "Für schnelle lokale Provider:" : "For fast local providers:"}</strong>{" "}
            {de
              ? "Der Filter deepglot_max_sync_batches kann eine begrenzte Zahl von Batches wieder im Seitenaufruf übersetzen. Für externe KI-Provider ist der asynchrone Standard empfohlen."
              : "The deepglot_max_sync_batches filter can translate a bounded number of batches during the page request. The asynchronous default is recommended for external AI providers."}
          </div>
        </section>

        <section id="activity-digest" className="scroll-mt-8 pt-20">
          <h2 className="text-3xl font-bold">{de ? "Wöchentlicher Workspace-Rückblick" : "Weekly workspace activity digest"}</h2>
          <p className="mt-5 max-w-4xl leading-7 text-gray-700">
            {de
              ? "Der Wochenrückblick ist ein Opt-in pro Benutzer und Workspace. Die Einstellung wird in den Kontoeinstellungen gespeichert; die PATCH-Route aktualisiert sowohl den Aktivierungsstatus als auch die gewünschte E-Mail-Sprache."
              : "The weekly digest is opt-in per user and workspace. The preference is stored in account settings; the PATCH route updates both the enabled state and the requested email locale."}
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {[
              {
                title: de ? "Zeitraum und Inhalt" : "Period and content",
                body: de
                  ? "Der Cron-Prozessor aggregiert die letzte vollständige UTC-Woche von Montag bis Montag. Er zählt neue Übersetzungen und Wörter, manuelle Übersetzungen und Wörter sowie Laufzeit-Übersetzungsanfragen — Import- und manuelle Batches werden nicht als Laufzeitanfragen gezählt."
                  : "The cron processor aggregates the previous complete UTC Monday-to-Monday week. It counts new translations and words, manual translations and words, and runtime translation requests; import and manual batches are not counted as runtime requests.",
              },
              {
                title: de ? "Zustellung und Wiederholung" : "Delivery and retry behavior",
                body: de
                  ? "Der geschützte Vercel-Cron läuft montags um 08:00 UTC. Wochen ohne Aktivität werden übersprungen. Ein eindeutiger Claim pro Benutzer, Workspace und Zeitraum verhindert Doppelzustellungen bei parallelen Aufrufen; fehlgeschlagene Sendungen geben ihren Claim frei."
                  : "The protected Vercel Cron runs at 08:00 UTC on Monday. Quiet weeks are skipped. A unique claim per user, workspace, and period prevents duplicate deliveries across concurrent invocations; failed sends release their claim for retry.",
              },
            ].map((item) => (
              <article key={item.title} className="rounded-md border border-[#d8d6ce] bg-white p-5">
                <h3 className="font-semibold text-[#071521]">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-gray-600">{item.body}</p>
              </article>
            ))}
          </div>
          <p className="mt-5 text-sm leading-6 text-gray-600">
            {de ? "Autoritative Implementierung:" : "Authoritative implementation:"}{" "}
            <code className="max-[350px]:[overflow-wrap:anywhere]">src/lib/activity-digest.ts</code>, <code className="max-[350px]:[overflow-wrap:anywhere]">src/lib/activity-digest-delivery.ts</code>, <code className="max-[350px]:[overflow-wrap:anywhere]">src/lib/activity-digest-cron.ts</code>, <code className="max-[350px]:[overflow-wrap:anywhere]">src/components/einstellungen/activity-digest-preferences.tsx</code>.
          </p>
        </section>

        <section id="wordpress-releases" className="scroll-mt-8 pt-20">
          <h2 className="text-3xl font-bold">{de ? "WordPress v0.11.4 bis v0.11.7" : "WordPress v0.11.4 through v0.11.7"}</h2>
          <p className="mt-5 max-w-4xl leading-7 text-gray-700">
            {de
              ? "Die dokumentierte Implementierungshistorie bildet die Grundlage für die aktuelle v0.12.6-Implementierung. v0.12.1 vergab für den Retry-After-fähigen dynamischen Übersetzer eine neue öffentliche Asset-Version. v0.12.2 verifiziert bei der URL-Synchronisierung genau eine sichere kanonische Weiterleitung, ohne automatisches Folgen zu aktivieren. v0.12.3 speichert Text- und URL-Warteschlangen in einer versionierten, prüfsummengeschützten ASCII-Hülle, damit Emoji und anderes Vier-Byte-Unicode auch auf älteren WordPress-Optionstabellen erhalten bleiben; beschädigte Persistenz wird nicht still ersetzt. v0.12.4 schützt auch übersetzte Transient-Werte mit einer getrennten versionierten ASCII-Hülle. Ein Cache-Schreibfehler bleibt in beiden Warteschlangen, verhindert den Seiten-Purge und hält eine nicht dauerhaft gespeicherte Inline-Antwort aus dem Seiten-Cache. v0.12.5 übersetzt gezielt konfigurierte Consent-Widgets auch dann, wenn sie vor dem dynamischen Footer-Observer entstehen, und lokalisiert deren interne Links mit den serverseitigen Routingregeln, ohne URLs an einen Übersetzungsanbieter zu senden. v0.12.6 übernimmt die WordPress-Core-Sichtbarkeit für Beitragstypen: Öffentliche Standardseiten bleiben in Sitemap und URL-Synchronisierung, während nicht sichtbare Builder-Inhaltstypen, Anhänge und nicht öffentlich abfragbare Taxonomien ausgeschlossen bleiben. Ein GitHub-Release oder ZIP-Bau installiert kein Kunden-Plugin automatisch; produktive Installation und Live-QA bleiben getrennte Freigaben."
              : "The documented implementation history forms the basis for the current v0.12.6 implementation. v0.12.1 assigned a new public asset version to the Retry-After-aware dynamic translator. v0.12.2 verifies exactly one safe canonical redirect during URL synchronization without enabling automatic redirect following. v0.12.3 stores text and URL queues in a versioned, checksummed ASCII envelope so emoji and other four-byte Unicode remain durable on legacy WordPress option tables; damaged persistence is not silently replaced. v0.12.4 protects translated transient values with a separate versioned ASCII envelope. A failed cache write stays in both queues, prevents the page purge, and keeps a non-durable inline result out of the page cache. v0.12.5 translates explicitly configured consent widgets even when they render before the dynamic footer observer and localizes their internal links with server-side routing rules without sending URLs to a translation provider. v0.12.6 follows WordPress core post-type viewability: built-in public pages remain in the sitemap and URL synchronization, while non-viewable builder content types, attachments, and non-queryable taxonomies stay excluded. A GitHub release or ZIP build does not automatically install a customer plugin; production installation and live QA remain separate approvals."}
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              ["v0.11.4", de ? "Numerische Quell-Slugs bleiben nach dem Cache-Readback zugeordnet." : "Numeric-only source slugs remain mapped after dedicated cache readback."],
              ["v0.11.5", de ? "Übersetzungsstapel erhalten ein begrenztes 60-Sekunden-Anfragefenster." : "Translation batches receive a bounded 60-second request window."],
              ["v0.11.6", de ? "Große kalte Seiten werden nach String-Anzahl und 2.000 UTF-8-Bytes in geordnete parallele Anfragen geteilt." : "Large cold pages split into ordered parallel requests bounded by string count and 2,000 UTF-8 bytes."],
              ["v0.11.7", de ? "Ein vertrauenswürdiger finaler HTML-Filter kann sprachabhängige Medien sicher lokalisieren und fällt bei leerem Ergebnis zurück." : "A trusted final HTML filter can localize language-specific media safely and falls back when the callback returns empty."],
            ].map(([version, description]) => (
              <div key={version} className="rounded-md border border-[#d8d6ce] bg-white px-4 py-3 text-sm leading-6">
                <strong className="mr-2 font-mono">{version}</strong>{description}
              </div>
            ))}
          </div>
        </section>

        <section id="errors" className="scroll-mt-8 pt-20">
          <h2 className="text-3xl font-bold">{de ? "Fehler und Wiederholungen" : "Errors and retries"}</h2>
          <p className="mt-5 leading-7 text-gray-700">
            {de
              ? "Öffentliche und Plugin-Routen verwenden einen Problem-Details-artigen JSON-Vertrag. error bleibt als Legacy-Alias für bestehende Plugin-Versionen erhalten. Clients sollen code und status auswerten; detail ist für Menschen."
              : "Public and plugin routes use a Problem Details-style JSON contract. error remains as a legacy alias for existing plugin versions. Clients should branch on code and status; detail is human-readable."}
          </p>
          <p className="mt-3 leading-7 text-gray-700">
            {de
              ? "Ein validation_failed für U+0000 bedeutet, dass ein Text-, Sprach-, Titel- oder Anfrage-URL-Feld ein von PostgreSQL nicht unterstütztes NUL-Zeichen enthält. Deepglot sendet solche Eingaben nicht an einen Anbieter und speichert sie nicht. Entferne ausschließlich U+0000 vor einem erneuten Versuch; andere Steuerzeichen und gültige Unicode-Zeichen sind erlaubt."
              : "A validation_failed response for U+0000 means a text, language, title, or request-URL field contains a NUL character that PostgreSQL cannot represent. Deepglot does not send that input to a provider or store it. Remove only U+0000 before retrying; other control characters and valid Unicode are supported."}
          </p>
          <p className="mt-3 leading-7 text-gray-700">
            {de
              ? "Wiederholbare 429-Antworten werden unter einem Idempotency-Key nur bis zum begrenzten Retry-After-Zeitpunkt gehalten: Parallele Anfragen mit demselben Key erhalten dieselbe Antwort, nach Ablauf darf der Key erneut ausführen. Ein 422 velocity_request_too_large ist dagegen dauerhaft für diese Anfrageform und wird regulär wiedergegeben. Teile eine zu große Anfrage oder PDF in kleinere Einheiten."
              : "Retryable 429 responses are not retained by Idempotency-Key beyond the bounded Retry-After window: concurrent same-key callers receive the same response, and the key may execute again after expiry. A 422 velocity_request_too_large is deterministic and retains the normal replay contract. Split an oversized request or PDF into smaller units."}
          </p>
          <div className="mt-5"><CodeBlock>{PROBLEM_DETAILS_EXAMPLE}</CodeBlock></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {["400 validation_failed", "401 missing_api_key / invalid_api_key", "402 quota_exhausted", "409 idempotency_conflict", "422 velocity_request_too_large", "429 rate_limit_exceeded / velocity_limited", "500 internal_error", "503 service_unavailable"].map((item) => (
              <div key={item} className="rounded-md border border-[#d8d6ce] bg-white px-4 py-3 font-mono text-xs">{item}</div>
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
            {PROJECT_WEBHOOK_DOC_EVENTS.map((event) => <li key={event} className="rounded-md border border-[#d8d6ce] bg-white px-4 py-3 font-mono text-sm">{event}</li>)}
          </ul>
        </section>

        <section id="project-surfaces" className="scroll-mt-8 pt-20">
          <h2 className="text-3xl font-bold">{de ? "Projektoberflächen" : "Project surfaces"}</h2>
          <p className="mt-5 leading-7 text-gray-700">
            {de
              ? "Diese Routen versorgen das Dashboard und sind nicht als externer stabiler REST-Vertrag freigegeben. API-Keys, Sprachen, Webhooks, Ausschlüsse und das Pro+-Übersetzungsgedächtnis benötigen Verwaltungsrechte. Menschliche Prüfungen und PDF-Übersetzungen sind zusätzlich projekt- und sprachgebunden; nur Verwaltende dürfen zuweisen oder freigeben. Glossar-CRUD verwendet derzeit die schwächere Projektmitgliedschaftsprüfung. Import, Export und Editor-Sitzungen verwenden angemeldete, projektspezifische Zugriffe."
              : "These routes power the dashboard and are not a stable external REST contract. API keys, languages, webhooks, exclusions, and the Pro+ translation-memory setting require management access. Human review and PDF translation are additionally project- and language-scoped; only managers may assign or approve. Glossary CRUD currently uses the weaker project-membership gate. Import, export, and editor sessions use signed-in, project-specific access."}
          </p>
          <div className="mt-6 overflow-x-auto rounded-md border border-[#d8d6ce] bg-white">
            <table className="w-full text-left text-sm"><thead className="bg-[#f1f0eb]"><tr><th className="px-4 py-3">Route</th><th className="px-4 py-3">Access</th></tr></thead><tbody>
              {DASHBOARD_DEVELOPER_SURFACES.map((surface) => <tr key={surface.path} className="border-t border-[#d8d6ce]"><td className="px-4 py-3 font-mono">{surface.path}</td><td className="px-4 py-3">{surface.access}</td></tr>)}
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
                className="font-medium text-[#c62812] hover:underline"
                href="https://github.com/ostheimer/deepglot/blob/main/docs/product-decisions/developer-surfaces.md"
              >
                {de ? "Entscheidungsprotokoll" : "Decision record"}
              </a>
            </p>
          </div>
        </section>

        <div className="mt-20 border-l-4 border-[#f03b22] bg-white p-6 text-sm text-[#58636d]">
          {de ? "Fragen oder Integrationsfeedback? " : "Questions or integration feedback? "}<a className="font-medium text-[#c62812] hover:underline" href="mailto:office@ostheimer.at">office@ostheimer.at</a>
          <span className="mx-2">·</span><Link className="font-medium text-[#c62812] hover:underline" href={getMarketingPath(locale, "home")}>{de ? "Zur Startseite" : "Back to homepage"}</Link>
        </div>
        </div>
      </main>
      <MarketingFooter locale={locale} />
    </div>
  );
}
