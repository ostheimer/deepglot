export type DocsLocale = "de" | "en";

export type LocalizedDocsText = {
  en: string;
  de: string;
};

export type PublicEndpointDoc = {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  sourceFile: string;
  audience: "public" | "plugin" | "dashboard";
  auth: LocalizedDocsText;
  summary: LocalizedDocsText;
  requestExample?: string;
  responseExample?: string;
  notes: LocalizedDocsText[];
};

export function docsText(locale: string, value: LocalizedDocsText) {
  return locale === "de" ? value.de : value.en;
}

export const PUBLIC_ENDPOINT_DOCS: readonly PublicEndpointDoc[] = [
  {
    id: "translate",
    method: "POST",
    path: "/api/translate",
    sourceFile: "src/app/api/translate/route.ts",
    audience: "public",
    auth: {
      en: "Project API key via Authorization: Bearer or ?api_key= query parameter.",
      de: "Projekt-API-Key über Authorization: Bearer oder den Query-Parameter ?api_key=.",
    },
    summary: {
      en: "Translates a batch of strings through the configured project provider while honoring cache, glossary, bot, quota, and velocity rules.",
      de: "Übersetzt einen Textstapel mit dem konfigurierten Projektanbieter und berücksichtigt Cache, Glossar, Bots, Kontingent und Geschwindigkeitslimit.",
    },
    requestExample: `curl https://deepglot.ai/api/translate \\
  -H "Authorization: Bearer dg_live_…" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 9b9e42d8-7ef2-4a91-82ff-b5ec71ba5832" \\
  -d '{
    "l_from": "de",
    "l_to": "en",
    "words": [{ "w": "Hallo Welt", "t": 1 }],
    "request_url": "https://example.com/",
    "bot": 0
  }'`,
    responseExample: `{
  "l_from": "de",
  "l_to": "en",
  "request_url": "https://example.com/",
  "title": "",
  "bot": 0,
  "cache_only": false,
  "from_words": ["Hallo Welt"],
  "to_words": ["Hello world"]
}`,
    notes: [
      {
        en: "Word type t follows the plugin contract. Human traffic uses bot=0; every bot value >=1 is cache-only and never invokes a provider.",
        de: "Der Worttyp t folgt dem Plugin-Vertrag. Menschlicher Traffic verwendet bot=0; jeder Bot-Wert ab 1 ist ausschließlich cachebasiert und ruft keinen Anbieter auf.",
      },
      {
        en: "cache_only is true for bots and when automatic translation is disabled. Clients may serve returned cache hits but must not persist source-identical cache misses as translations.",
        de: "cache_only ist für Bots sowie bei deaktivierter automatischer Übersetzung true. Clients dürfen gelieferte Cache-Treffer ausgeben, aber quelltextgleiche Cache-Fehlschläge nicht als Übersetzungen speichern.",
      },
      {
        en: "Only fresh provider-billed words consume monthly quota. A 402 means quota exhaustion; a 429 includes Retry-After for request or fresh-word velocity limits.",
        de: "Nur neue, beim Anbieter abgerechnete Wörter verbrauchen das Monatskontingent. 402 bedeutet Kontingentüberschreitung; 429 enthält Retry-After für Anfrage- oder Wortgeschwindigkeitslimits.",
      },
      {
        en: "Idempotency-Key is optional. Success and deterministic responses can be replayed for up to 24 hours without repeating side effects. A retryable 429 is deduplicated and replayed only for its bounded Retry-After window; after that, the same key starts a new execution. A different body returns 409 only while the record is retained.",
        de: "Idempotency-Key ist optional. Erfolgreiche und deterministische Antworten können bis zu 24 Stunden ohne erneute Seiteneffekte wiedergegeben werden. Eine wiederholbare 429 wird nur während des begrenzten Retry-After-Fensters dedupliziert und wiedergegeben; danach wird derselbe Key neu ausgeführt. Ein anderer Body führt zu 409, solange der Datensatz gespeichert ist.",
      },
    ],
  },
  {
    id: "status",
    method: "GET",
    path: "/api/public/status",
    sourceFile: "src/app/api/public/status/route.ts",
    audience: "public",
    auth: { en: "None.", de: "Keine." },
    summary: {
      en: "Checks API and database availability. Returns 200 when ready and a 503 Problem Details body when unavailable.",
      de: "Prüft die Verfügbarkeit von API und Datenbank. Liefert 200 bei Bereitschaft und bei Ausfall einen Problem-Details-Body mit 503.",
    },
    responseExample: `HTTP/1.1 200 OK

// Database unavailable: HTTP 503 with a service_unavailable Problem Details body.`,
    notes: [],
  },
  {
    id: "languages",
    method: "GET",
    path: "/api/public/languages",
    sourceFile: "src/app/api/public/languages/route.ts",
    audience: "public",
    auth: { en: "None.", de: "Keine." },
    summary: {
      en: "Lists the canonical supported language catalog and whether each language is shared across all configurable providers.",
      de: "Listet den kanonischen Sprachkatalog und zeigt, ob eine Sprache von allen konfigurierbaren Anbietern gemeinsam unterstützt wird.",
    },
    responseExample: `[
  {
    "code": "de",
    "local_name": "Deutsch",
    "english_name": "German",
    "sharedAcrossProviders": true
  }
]`,
    notes: [
      {
        en: "Provider-specific coverage can be narrower. Check the configured provider before promising a language pair.",
        de: "Die Abdeckung eines einzelnen Anbieters kann kleiner sein. Prüfe den konfigurierten Anbieter, bevor du ein Sprachpaar zusagst.",
      },
    ],
  },
  {
    id: "language-pair",
    method: "GET",
    path: "/api/public/languages/is-supported?languageFrom=de&languageTo=en",
    sourceFile: "src/app/api/public/languages/is-supported/route.ts",
    audience: "public",
    auth: { en: "None.", de: "Keine." },
    summary: {
      en: "Checks whether both language codes are in the canonical catalog and are different.",
      de: "Prüft, ob beide unterschiedlichen Sprachcodes im kanonischen Katalog enthalten sind.",
    },
    responseExample: `{ "is_supported": true }`,
    notes: [],
  },
  {
    id: "runtime-config",
    method: "GET",
    path: "/api/plugin/runtime-config",
    sourceFile: "src/app/api/plugin/runtime-config/route.ts",
    audience: "plugin",
    auth: {
      en: "Project API key via bearer header or query parameter.",
      de: "Projekt-API-Key über Bearer-Header oder Query-Parameter.",
    },
    summary: {
      en: "Returns the authoritative SaaS project settings together with normalized translation exclusions, collision-safe translated URL slugs, and the synchronization timestamp used by the WordPress runtime.",
      de: "Liefert die autoritativen SaaS-Projekteinstellungen zusammen mit normalisierten Übersetzungsausschlüssen, kollisionssicheren übersetzten URL-Slugs und dem Synchronisationszeitpunkt für die WordPress-Laufzeit.",
    },
    responseExample: `{
  "exclusions": { "urls": [], "regexes": [], "selectors": [] },
  "pageViewsEnabled": false,
  "project": {
    "version": "2026-08-25T10:00:00.000Z",
    "name": "Example website",
    "domain": "example.com",
    "sourceLanguage": "de",
    "targetLanguages": ["en"],
    "autoRedirect": false,
    "displayAiNotice": true,
    "automaticTranslation": true,
    "websiteType": "Corporate website",
    "industryType": "Software & technology"
  },
  "urlSlugs": [
    { "originalSlug": "ueber-uns", "translatedSlug": "about-us", "langTo": "en" }
  ],
  "syncedAt": "2026-07-13T10:00:00.000Z"
}`,
    notes: [
      {
        en: "The project block is the authoritative runtime readback for SaaS-managed project settings and includes their current version.",
        de: "Der project-Block ist die autoritative Laufzeitansicht der im SaaS verwalteten Projekteinstellungen und enthält deren aktuelle Version.",
      },
      {
        en: "Mappings that would shadow another source slug or have an ambiguous reverse mapping are omitted. Projects above the bounded 10,000-record runtime contract receive a 413 error instead of a silently truncated map.",
        de: "Zuordnungen, die einen anderen Quell-Slug verdecken oder keine eindeutige Rückwärtszuordnung besitzen, werden ausgelassen. Projekte oberhalb des begrenzten Runtime-Vertrags mit 10.000 Zeilen erhalten einen 413-Fehler statt einer unbemerkt abgeschnittenen Zuordnung.",
      },
    ],
  },
  {
    id: "settings-sync",
    method: "POST",
    path: "/api/plugin/settings-sync",
    sourceFile: "src/app/api/plugin/settings-sync/route.ts",
    audience: "plugin",
    auth: {
      en: "Project API key via bearer header or query parameter.",
      de: "Projekt-API-Key über Bearer-Header oder Query-Parameter.",
    },
    summary: {
      en: "Stores WordPress-owned routing and runtime options while comparing mirrored project values with the authoritative SaaS configuration.",
      de: "Speichert WordPress-eigene Routing- und Laufzeitoptionen und vergleicht dabei gespiegelte Projektwerte mit der autoritativen SaaS-Konfiguration.",
    },
    requestExample: `{
  "routingMode": "PATH_PREFIX",
  "siteUrl": "https://example.com",
  "sourceLanguage": "de",
  "targetLanguages": ["en"],
  "autoRedirect": false,
  "translateEmails": false,
  "translateSearch": true,
  "translateAmp": false,
  "domainMappings": []
}`,
    responseExample: `{
  "ok": true,
  "project": {
    "id": "project-id",
    "name": "Example website",
    "domain": "example.com",
    "originalLang": "de",
    "languages": [{ "langCode": "en", "isActive": true }]
  },
  "mirrorConflicts": ["domain", "autoRedirect"]
}`,
    notes: [
      {
        en: "SaaS is authoritative for the project name, domain, source and target languages, automatic redirect, AI notice, automatic translation, website type, and industry context. Incoming mirrored differences are listed in mirrorConflicts and are not written back.",
        de: "Das SaaS ist autoritativ für Projektname, Domain, Quell- und Zielsprachen, automatische Weiterleitung, KI-Hinweis, automatische Übersetzung, Website-Typ und Branchenkontext. Eingehende gespiegelte Abweichungen werden in mirrorConflicts aufgeführt und nicht zurückgeschrieben.",
      },
      {
        en: "WordPress is authoritative for routing mode, domain mappings, and email, search, and AMP translation. Client-side dynamic translation remains plugin-local and is not written into the SaaS project.",
        de: "WordPress ist autoritativ für Routing-Modus, Domain-Zuordnungen sowie E-Mail, Suche und AMP. Die clientseitige dynamische Übersetzung bleibt plugin-lokal und wird nicht in das SaaS-Projekt geschrieben.",
      },
      {
        en: "In SUBDOMAIN mode, mapped target languages use their unique host; unmapped target languages fall back to path prefixes on the source host.",
        de: "Im Modus SUBDOMAIN verwenden zugeordnete Zielsprachen ihren eindeutigen Host; nicht zugeordnete Zielsprachen werden über Pfad-Präfixe auf dem Quellhost ausgeliefert.",
      },
    ],
  },
];

export const DASHBOARD_DEVELOPER_SURFACES = [
  {
    path: "/api/projects/[projektId]/api-keys",
    sourceFile: "src/app/api/projects/[projektId]/api-keys/route.ts",
    access: "manage",
  },
  {
    path: "/api/projects/[projektId]/languages",
    sourceFile: "src/app/api/projects/[projektId]/languages/route.ts",
    access: "manage",
  },
  {
    path: "/api/projects/[projektId]/glossary",
    sourceFile: "src/app/api/projects/[projektId]/glossary/route.ts",
    access: "member",
  },
  {
    path: "/api/projects/[projektId]/exclusions",
    sourceFile: "src/app/api/projects/[projektId]/exclusions/route.ts",
    access: "manage",
  },
  {
    path: "/api/projects/[projektId]/import",
    sourceFile: "src/app/api/projects/[projektId]/import/route.ts",
    access: "session",
  },
  {
    path: "/api/projects/[projektId]/export",
    sourceFile: "src/app/api/projects/[projektId]/export/route.ts",
    access: "session",
  },
  {
    path: "/api/projects/[projektId]/editor-sessions",
    sourceFile: "src/app/api/projects/[projektId]/editor-sessions/route.ts",
    access: "session",
  },
  {
    path: "/api/projects/[projektId]/translation-memory",
    sourceFile:
      "src/app/api/projects/[projektId]/translation-memory/route.ts",
    access: "manage / Pro+",
  },
  {
    path: "/api/projects/[projektId]/translations",
    sourceFile: "src/app/api/projects/[projektId]/translations/route.ts",
    access: "project / language scoped",
  },
  {
    path: "/api/projects/[projektId]/translations/[translationId]",
    sourceFile:
      "src/app/api/projects/[projektId]/translations/[translationId]/route.ts",
    access: "edit / metadata: manager or assigned translator; delete: manager",
  },
  {
    path: "/api/projects/[projektId]/pdf-translations",
    sourceFile:
      "src/app/api/projects/[projektId]/pdf-translations/route.ts",
    access: "project / language scoped",
  },
  {
    path: "/api/projects/[projektId]/webhooks",
    sourceFile: "src/app/api/projects/[projektId]/webhooks/route.ts",
    access: "manage",
  },
] as const;

export const WORDPRESS_REST_ENDPOINTS = [
  "GET /wp-json/deepglot/v1/settings",
  "PUT /wp-json/deepglot/v1/settings",
  "PATCH /wp-json/deepglot/v1/settings",
  "GET /wp-json/deepglot/v1/status",
  "POST /wp-json/deepglot/v1/test-connection",
  "GET /wp-json/deepglot/v1/url-sync",
  "POST /wp-json/deepglot/v1/url-sync/preview",
  "POST /wp-json/deepglot/v1/url-sync",
  "POST /wp-json/deepglot/v1/url-sync/pause",
  "POST /wp-json/deepglot/v1/url-sync/resume",
  "POST /wp-json/deepglot/v1/url-sync/retry-failed",
  "DELETE /wp-json/deepglot/v1/url-sync",
  "POST /wp-json/deepglot/v1/translate-dynamic",
] as const;

export const PROBLEM_DETAILS_EXAMPLE = `{
  "type": "https://deepglot.ai/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "languageFrom and languageTo are required.",
  "code": "validation_failed",
  "instance": "/api/public/languages/is-supported",
  "error": "languageFrom and languageTo are required.",
  "errors": { "languageFrom": ["Required"], "languageTo": ["Required"] }
}`;

export const PROJECT_WEBHOOK_DOC_EVENTS = [
  "translation.created",
  "translation.updated",
  "translation.manual_updated",
  "translation.deleted",
  "glossary.upserted",
  "glossary.deleted",
  "slug.upserted",
  "import.completed",
] as const;
