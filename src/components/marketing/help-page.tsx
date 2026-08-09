import Link from "next/link";
import {
  ArrowRight,
  CalendarBlank,
  Clock,
  EnvelopeSimple,
  Funnel,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";

import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import type { BilingualPublicLocale } from "@/lib/bilingual-public-content";
import { getMarketingPath } from "@/lib/site-locale";

const RELEASES = [
  {
    version: "v0.11.7",
    title: { en: "Trusted final HTML filter", de: "Vertrauenswürdiger finaler HTML-Filter" },
    body: {
      en: "Site-specific callbacks can safely localize trusted final HTML, such as language-specific media embeds, without replacing the complete translated document when a callback returns an empty result.",
      de: "Website-spezifische Callbacks können vertrauenswürdiges finales HTML sicher lokalisieren, etwa sprachabhängige Medieneinbettungen. Liefert ein Callback leer zurück, bleibt das vollständige übersetzte Dokument erhalten.",
    },
  },
  {
    version: "v0.11.6",
    title: { en: "Bounded large-page translation", de: "Begrenzte Übersetzung großer Seiten" },
    body: {
      en: "Content-heavy pages are split into ordered parallel requests, each bounded by 200 strings and 2,000 UTF-8 source bytes.",
      de: "Inhaltsreiche Seiten werden in geordnete parallele Anfragen aufgeteilt. Jede Anfrage ist auf 200 Zeichenketten und 2.000 UTF-8-Bytes begrenzt.",
    },
  },
  {
    version: "v0.11.5",
    title: { en: "A 60-second legacy window", de: "Ein 60-Sekunden-Fenster für ältere Abläufe" },
    body: {
      en: "Legacy translation batches can use a bounded 60-second request window, giving valid large-page batches more time to complete before falling back.",
      de: "Ältere Übersetzungsstapel erhalten ein begrenztes Anfragefenster von 60 Sekunden. Gültige große Seiten haben dadurch mehr Zeit, bevor ein Rückfall greift.",
    },
  },
  {
    version: "v0.11.4",
    title: { en: "Numeric source slugs stay mapped", de: "Numerische Quell-Slugs bleiben zugeordnet" },
    body: {
      en: "Source slugs made only of digits remain valid when the dedicated WordPress cache is read back, so existing translated routes keep resolving after runtime synchronization.",
      de: "Quell-Slugs, die ausschließlich aus Ziffern bestehen, bleiben beim Lesen aus dem dedizierten WordPress-Cache gültig. Bestehende übersetzte Routen bleiben nach der Laufzeitsynchronisierung erreichbar.",
    },
  },
] as const;

const DIGEST_POINTS = {
  en: [
    ["Opt in per workspace", "Enable the preference in account settings for each workspace separately."],
    ["Monday delivery", "The protected cron runs on Monday and summarizes the previous complete UTC week."],
    ["Quiet weeks stay quiet", "No activity means no email, so an empty week does not create noise."],
    ["One delivery per recipient", "Atomic period claims prevent duplicate emails when the cron runs concurrently; failed sends can retry."],
  ],
  de: [
    ["Pro Workspace aktivieren", "Aktiviere die Einstellung in den Kontoeinstellungen für jeden Workspace separat."],
    ["Zustellung am Montag", "Der geschützte Cron läuft montags und fasst die letzte vollständige UTC-Woche zusammen."],
    ["Ruhige Wochen bleiben ruhig", "Ohne Aktivität wird keine E-Mail versendet, damit leere Wochen keinen Lärm erzeugen."],
    ["Eine Zustellung pro Empfänger", "Atomare Perioden-Claims verhindern bei parallelen Cron-Läufen doppelte E-Mails; fehlgeschlagene Sendungen können wiederholt werden."],
  ],
} as const;

export function HelpPage({ locale }: { locale: BilingualPublicLocale }) {
  const de = locale === "de";
  const digestPoints = de ? DIGEST_POINTS.de : DIGEST_POINTS.en;
  const docsHref = getMarketingPath(locale, "docs");

  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#071521]">
      <MarketingNav locale={locale} active="help" />

      <main>
        <header className="border-b border-[#d8d6ce] bg-[#071521] text-white">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#f77a65]">
              {de ? "Hilfe und Produktwissen" : "Help and product notes"}
            </p>
            <h1 className="mt-4 max-w-4xl text-5xl font-extrabold tracking-[-0.05em] sm:text-6xl">
              {de ? "Deepglot verständlich erklärt" : "Deepglot, explained clearly"}
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-white/65">
              {de
                ? "Praktische Hinweise zu Workspace-Aktivität, WordPress-Versionen und den Grenzen, die im Betrieb wichtig sind."
                : "Practical notes on workspace activity, WordPress releases, and the boundaries that matter in operation."}
            </p>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <nav
            aria-label={de ? "Hilfebereiche" : "Help sections"}
            className="flex flex-wrap gap-3 text-sm"
          >
            <a href="#weekly-digest" className="rounded-md border border-[#c9c7be] bg-white px-4 py-2 font-semibold transition-colors hover:border-[#f03b22] hover:text-[#d92f19]">
              {de ? "Wochenrückblick" : "Weekly digest"}
            </a>
            <a href="#wordpress-warmup" className="rounded-md border border-[#c9c7be] bg-white px-4 py-2 font-semibold transition-colors hover:border-[#f03b22] hover:text-[#d92f19]">
              {de ? "WordPress-Aufwärmung" : "WordPress warm-up"}
            </a>
            <a href="#text-safety" className="rounded-md border border-[#c9c7be] bg-white px-4 py-2 font-semibold transition-colors hover:border-[#f03b22] hover:text-[#d92f19]">
              {de ? "Textgrenzen" : "Text boundaries"}
            </a>
            <a href="#rate-limit-backoff" className="rounded-md border border-[#c9c7be] bg-white px-4 py-2 font-semibold transition-colors hover:border-[#f03b22] hover:text-[#d92f19]">
              {de ? "429 und Wartezeit" : "429 and backoff"}
            </a>
            <a href="#wordpress-releases" className="rounded-md border border-[#c9c7be] bg-white px-4 py-2 font-semibold transition-colors hover:border-[#f03b22] hover:text-[#d92f19]">
              WordPress 0.11.4–0.11.7
            </a>
            <Link href={docsHref} className="rounded-md border border-[#c9c7be] bg-white px-4 py-2 font-semibold transition-colors hover:border-[#f03b22] hover:text-[#d92f19]">
              {de ? "Entwicklerdokumentation" : "Developer documentation"}
            </Link>
          </nav>

          <section id="weekly-digest" data-testid="help-weekly-digest" className="scroll-mt-8 pt-20">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#c62812]">
                {de ? "Workspace-Aktivität" : "Workspace activity"}
              </p>
              <h2 className="mt-3 text-4xl font-extrabold tracking-[-0.045em]">
                {de ? "Der Wochenrückblick auf einen Blick" : "Your weekly digest at a glance"}
              </h2>
              <p className="mt-5 text-lg leading-8 text-[#58636d]">
                {de
                  ? "Der Wochenrückblick ist eine freiwillige E-Mail pro Benutzer und Workspace. Er zeigt neue Übersetzungen und Wörter, manuelle Bearbeitungen und Laufzeit-Übersetzungsanfragen aus der letzten vollständigen UTC-Woche."
                  : "The weekly digest is an opt-in email per user and workspace. It reports new translations and words, manual edits, and runtime translation requests from the previous complete UTC week."}
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Funnel, title: digestPoints[0][0], body: digestPoints[0][1] },
                { icon: CalendarBlank, title: digestPoints[1][0], body: digestPoints[1][1] },
                { icon: Clock, title: digestPoints[2][0], body: digestPoints[2][1] },
                { icon: ShieldCheck, title: digestPoints[3][0], body: digestPoints[3][1] },
              ].map((item) => (
                <article key={item.title} className="rounded-md border border-[#d8d6ce] bg-white p-5">
                  <item.icon className="h-7 w-7 text-[#c62812]" weight="regular" />
                  <h3 className="mt-5 text-lg font-bold [overflow-wrap:anywhere]">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#58636d]">{item.body}</p>
                </article>
              ))}
            </div>

            <div className="mt-6 grid gap-4 rounded-2xl bg-[#fff0ec] p-6 text-sm leading-7 text-[#5e1f14] md:grid-cols-[auto_1fr] md:items-start">
              <EnvelopeSimple className="h-7 w-7" weight="regular" />
              <p>
                <strong>{de ? "Wichtig:" : "Important:"}</strong>{" "}
                {de
                  ? "Der Versand ist auf Benutzer mit aktivierter Einstellung begrenzt. Ein Benutzer sieht nur die Projekte, die über seine Workspace- oder Projektmitgliedschaft in seinem Zugriff liegen."
                  : "Delivery is limited to users who enabled the setting. Each recipient sees only projects available through their workspace or project membership."}
              </p>
            </div>
          </section>

          <section id="wordpress-warmup" data-testid="help-wordpress-warmup" className="scroll-mt-8 pt-24">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#c62812]">
                {de ? "Hintergrundübersetzung" : "Background translation"}
              </p>
              <h2 className="mt-3 text-4xl font-extrabold tracking-[-0.045em]">
                {de ? "Wie kalte WordPress-Seiten warm werden" : "How cold WordPress pages warm up"}
              </h2>
              <p className="mt-5 text-lg leading-8 text-[#58636d]">
                {de
                  ? "Der erste Aufruf einer kalten Zielsprachenseite darf Quelltext zeigen, während WP-Cron fehlende Segmente im Hintergrund übersetzt. Deepglot behält dabei die lokalisierte URL des Besuchers als späteres Cache-Ziel, auch wenn WordPress intern bereits auf den Quellpfad umgeschrieben hat."
                  : "The first request to a cold target-language page may show source content while WP-Cron translates missing segments in the background. Deepglot retains the visitor's localized URL as the later cache target even after WordPress has internally rewritten the request to its source path."}
              </p>
              <p className="mt-4 text-sm leading-7 text-[#58636d]">
                {de
                  ? "Sobald Warteschlange und fälliges Ereignis gespeichert sind, stößt Deepglot pro Anfrage einmal nicht blockierend WP-Cron an. Bei DISABLE_WP_CRON oder während eines Cron-Laufs bleibt dieser Anstoß aus. WP Rocket, W3 Total Cache und LiteSpeed Cache leeren fertig übersetzte URLs einzeln. WP Super Cache bietet nur einen globalen Purge; Deepglot wartet deshalb, bis die verfolgte Warteschlange leer ist, damit ausstehende Seiten im Cache bleiben. Fehlgeschlagene oder unvollständige Übersetzungen bleiben vorgemerkt und können bei einem späteren Cron-Lauf erneut versucht werden."
                  : "Once the queue and due event are stored, Deepglot makes one non-blocking WP-Cron nudge per request. That nudge is skipped for DISABLE_WP_CRON and while cron is already running. WP Rocket, W3 Total Cache, and LiteSpeed Cache purge completed URLs individually. WP Super Cache exposes only a global purge, so Deepglot waits until the tracked queue is empty and pending pages stay cached. Failed or partial translations remain queued for a later cron retry."}
              </p>
            </div>
          </section>

          <section id="text-safety" data-testid="help-text-safety" className="scroll-mt-8 pt-24">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#c62812]">
                {de ? "Sichere Textverarbeitung" : "Safe text handling"}
              </p>
              <h2 className="mt-3 text-4xl font-extrabold tracking-[-0.045em]">
                {de ? "Warum Deepglot U+0000 ablehnt" : "Why Deepglot rejects U+0000"}
              </h2>
              <p className="mt-5 text-lg leading-8 text-[#58636d]">
                {de
                  ? "PostgreSQL kann das NUL-Zeichen U+0000 weder in Text noch in JSON speichern. Deepglot lehnt es deshalb in API-, Editor- und Import-Eingaben vor Anbieteraufrufen und vor der Persistenz von Übersetzungsinhalten mit einem Validierungsfehler ab. Andere gültige Unicode-Zeichen bleiben unverändert."
                  : "PostgreSQL cannot store the U+0000 null byte in text or JSON. Deepglot therefore rejects it in API, editor, and import input with a validation error before provider calls and before translation content is persisted. Other valid Unicode characters remain unchanged."}
              </p>
              <p className="mt-4 text-sm leading-7 text-[#58636d]">
                {de
                  ? "Enthält stattdessen die Antwort eines Übersetzungsanbieters U+0000, wird dieses Ergebnis nicht gespeichert. Ein konfigurierter Ersatzanbieter kann übernehmen; schlägt auch die Anbieterkette fehl, endet die Anfrage ohne Versuch, Übersetzungsinhalte zu persistieren. Protokolliert werden nur Grenze, Feld, Anzahl und Anbieter — niemals Text oder URL."
                  : "If a translation provider response contains U+0000, that result is not stored. A configured fallback provider can take over; if the provider chain still fails, the request ends without attempting translation-content persistence. Logs contain only the boundary, field, count, and provider — never text or URLs."}
              </p>
            </div>
          </section>

          <section id="rate-limit-backoff" data-testid="help-rate-limit-backoff" className="scroll-mt-8 pt-24">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#c62812]">
                {de ? "Begrenzte Wiederholungen" : "Bounded retries"}
              </p>
              <h2 className="mt-3 text-4xl font-extrabold tracking-[-0.045em] [overflow-wrap:anywhere]">
                {de
                  ? "429 ohne Wiederholungsschleife beachten"
                  : "Respecting a 429 without a retry storm"}
              </h2>
              <p className="mt-5 text-lg leading-8 text-[#58636d]">
                {de
                  ? "Ein HTTP 429 ist eine vorübergehende Begrenzung, kein verbrauchtes Monatskontingent. Deepglot übernimmt Retry-After als Sekundenwert oder HTTP-Datum und begrenzt die Wartezeit auf 1 bis 300 Sekunden. Fehlt ein gültiger Wert, gelten 60 Sekunden. Das Stundenlimit selbst wurde dabei nicht angehoben."
                  : "HTTP 429 is a temporary limit, not exhausted monthly quota. Deepglot accepts Retry-After as delta seconds or an HTTP date and bounds the delay to 1 to 300 seconds. An invalid or missing value uses 60 seconds. This does not raise the hourly threshold."}
              </p>
            </div>

            <div data-testid="rate-limit-backoff-flow" className="mt-10 grid gap-4 md:grid-cols-3">
              {[
                {
                  step: "1",
                  title: de ? "429 einordnen" : "Classify the 429",
                  body: de
                    ? "Die Antwort unterscheidet Anfrage- und Wortgeschwindigkeitslimits und liefert eine begrenzte Wartezeit."
                    : "The response distinguishes request and fresh-word velocity limits and provides a bounded delay.",
                },
                {
                  step: "2",
                  title: de ? "Weitere Aufrufe stoppen" : "Stop later calls",
                  body: de
                    ? "Nach dem ersten seriellen 429 sendet der WordPress-Client keine weiteren Stapel dieser Folge. Bereits gestartete parallele Stapel behalten ihre eigenen Antworten; für neue dynamische Arbeit gilt die längste Wartezeit."
                    : "After the first sequential 429, the WordPress client sends no later batches in that sequence. Parallel batches already in flight keep their own responses; new dynamic work keeps the longest delay.",
                },
                {
                  step: "3",
                  title: de ? "Cache und Queue schützen" : "Protect cache and queues",
                  body: de
                    ? "Die Warmup-Queue wartet bis Retry-After. Dynamische Besucheranfragen werden nicht sofort wiederholt; Cache-Treffer bleiben verfügbar, sonst bleibt vorübergehend der Quelltext sichtbar."
                    : "The warmup queue waits until Retry-After. Dynamic visitor requests are not immediately retried; cache hits remain available and other content temporarily stays in the source language.",
                },
              ].map((item) => (
                <article key={item.step} className="rounded-md border border-[#d8d6ce] bg-white p-6">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#071521] text-sm font-bold text-white">
                    {item.step}
                  </span>
                  <h3 className="mt-5 text-lg font-bold [overflow-wrap:anywhere]">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-[#58636d]">{item.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section id="wordpress-releases" data-testid="help-wordpress-releases" className="scroll-mt-8 pt-24">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#c62812]">WordPress</p>
              <h2 className="mt-3 text-4xl font-extrabold tracking-[-0.045em]">
                {de ? "Was v0.11.4 bis v0.11.7 gelöst haben" : "What WordPress v0.11.4–v0.11.7 changed"}
              </h2>
              <p className="mt-5 text-lg leading-8 text-[#58636d]">
                {de
                  ? "Diese vier Releases stabilisieren URL-Auflösung, große kalte Seiten und vertrauenswürdige Site-spezifische Nachbearbeitung. Sie ersetzen keine Produktionsfreigabe: Ein veröffentlichtes Paket installiert oder aktualisiert kein Kunden-Plugin automatisch."
                  : "These four releases stabilize URL resolution, large cold pages, and trusted site-specific post-processing. They do not replace a production approval: publishing a package does not automatically install or update a customer plugin."}
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2">
              {RELEASES.map((release) => (
                <article key={release.version} className="rounded-md border border-[#d8d6ce] bg-white p-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-[#071521] px-3 py-1 font-mono text-xs font-bold text-white">{release.version}</span>
                    <h3 className="text-xl font-bold [overflow-wrap:anywhere]">{de ? release.title.de : release.title.en}</h3>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-[#58636d]">{de ? release.body.de : release.body.en}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-24 grid gap-6 rounded-2xl bg-[#071521] p-7 text-white sm:p-10 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#f77a65]">
                {de ? "Weiterführend" : "Keep going"}
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-[-0.035em]">
                {de ? "Technische Verträge nachschlagen" : "Look up the technical contracts"}
              </h2>
              <p className="mt-3 max-w-2xl leading-7 text-white/65">
                {de
                  ? "Die Entwicklerdokumentation enthält API-, WordPress-, Fehler-, Webhook- und Projektoberflächen mit Quellenlinks."
                  : "The developer documentation covers API, WordPress, errors, webhooks, and project surfaces with source links."}
              </p>
            </div>
            <Link href={docsHref} className="inline-flex items-center justify-center rounded-md bg-[#d92f19] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#c62812]">
              {de ? "Zur Entwicklerdoku" : "Open developer docs"}
              <ArrowRight className="ml-2 h-4 w-4" weight="bold" />
            </Link>
          </section>
        </div>
      </main>

      <MarketingFooter locale={locale} />
    </div>
  );
}
