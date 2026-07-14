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
  "from_words": ["Hallo Welt"],
  "to_words": ["Hello world"]
}`,
    notes: [
      {
        en: "Word type t follows the plugin contract. Human traffic uses bot=0; every bot value >=1 is cache-only and never invokes a provider.",
        de: "Der Worttyp t folgt dem Plugin-Vertrag. Menschlicher Traffic verwendet bot=0; jeder Bot-Wert ab 1 ist ausschließlich cachebasiert und ruft keinen Anbieter auf.",
      },
      {
        en: "Only fresh provider-billed words consume monthly quota. A 402 means quota exhaustion; a 429 includes Retry-After for request or fresh-word velocity limits.",
        de: "Nur neue, beim Anbieter abgerechnete Wörter verbrauchen das Monatskontingent. 402 bedeutet Kontingentüberschreitung; 429 enthält Retry-After für Anfrage- oder Wortgeschwindigkeitslimits.",
      },
      {
        en: "Idempotency-Key is optional. Repeating the same body and key within 24 hours replays the first response without repeating side effects; a different body returns 409.",
        de: "Idempotency-Key ist optional. Derselbe Body und Key liefern innerhalb von 24 Stunden die erste Antwort erneut, ohne Seiteneffekte zu wiederholen; ein anderer Body führt zu 409.",
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
      en: "Returns normalized translation exclusions and the synchronization timestamp used by the WordPress runtime.",
      de: "Liefert normalisierte Übersetzungsausschlüsse und den Synchronisationszeitpunkt für die WordPress-Laufzeit.",
    },
    responseExample: `{
  "exclusions": { "urls": [], "selectors": [], "content": [] },
  "syncedAt": "2026-07-13T10:00:00.000Z"
}`,
    notes: [],
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
      en: "Synchronizes WordPress routing, languages, runtime options, source host, and optional subdomain mappings into the project.",
      de: "Synchronisiert WordPress-Routing, Sprachen, Laufzeitoptionen, Quellhost und optionale Subdomain-Zuordnungen in das Projekt.",
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
    "originalLang": "de",
    "languages": [{ "langCode": "en", "isActive": true }]
  }
}`,
    notes: [
      {
        en: "SUBDOMAIN mode requires one unique domain mapping for every active target language.",
        de: "Der Modus SUBDOMAIN benötigt für jede aktive Zielsprache eine eindeutige Domain-Zuordnung.",
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
    access: "manager or assigned translator",
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
  "glossary.upserted",
  "glossary.deleted",
  "slug.upserted",
  "import.completed",
] as const;
