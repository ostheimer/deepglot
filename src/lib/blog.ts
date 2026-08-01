import {
  SITE_LOCALE_METADATA,
  type SiteLocale,
  withLocalePrefix,
} from "@/lib/site-locale";

type BlogPostCopy = {
  title: string;
  excerpt: string;
  category: string;
  sections: ReadonlyArray<{
    heading: string;
    paragraphs: readonly string[];
  }>;
};

export type BlogPost = {
  id: string;
  slug: string;
  publishedAt: string;
  readingMinutes: number;
  copy: BlogPostCopy;
};

type BlogPostSource = {
  id: string;
  slugs: { en: string; de: string };
  publishedAt: string;
  readingMinutes: number;
  copy: { en: BlogPostCopy; de: BlogPostCopy };
};

const BLOG_POSTS: readonly BlogPostSource[] = [
  {
    id: "portability",
    slugs: {
      en: "wordpress-translation-without-lock-in",
      de: "wordpress-uebersetzen-ohne-lock-in",
    },
    publishedAt: "2026-08-01",
    readingMinutes: 5,
    copy: {
      en: {
        title: "WordPress translation without subscription lock-in",
        excerpt:
          "Why multilingual publishing should leave your content, routes, and provider choices under your control.",
        category: "Product principles",
        sections: [
          {
            heading: "Translation should be infrastructure, not a trap",
            paragraphs: [
              "A multilingual website becomes part of a company’s core publishing infrastructure. Its translations, localized URLs, glossary decisions, and search visibility should not disappear when a subscription changes.",
              "Deepglot is designed around that premise: translations stay accessible to the project, can be exported, and can be served from the WordPress integration without turning every page view into a new translation purchase.",
            ],
          },
          {
            heading: "Choice at the provider layer",
            paragraphs: [
              "Different sites need different translation models, cost profiles, and data boundaries. Deepglot supports multiple providers and compatible gateways so the publishing workflow is not welded to one model vendor.",
              "That flexibility also makes a self-hosted path possible for teams that need more control over infrastructure and data handling.",
            ],
          },
          {
            heading: "A WordPress-first workflow",
            paragraphs: [
              "The plugin translates the rendered site, keeps cached results close to WordPress, and supports multilingual routes and hreflang output. Editors can review and correct results instead of treating machine output as untouchable.",
              "The goal is simple: adopt multilingual publishing without surrendering the content operation that already works for your team.",
            ],
          },
        ],
      },
      de: {
        title: "WordPress übersetzen – ohne Abo-Lock-in",
        excerpt:
          "Warum mehrsprachiges Publizieren deine Inhalte, Routen und Provider-Entscheidungen unter deiner Kontrolle lassen sollte.",
        category: "Produktprinzipien",
        sections: [
          {
            heading: "Übersetzung ist Infrastruktur, keine Falle",
            paragraphs: [
              "Eine mehrsprachige Website wird Teil der zentralen Publishing-Infrastruktur eines Unternehmens. Übersetzungen, lokalisierte URLs, Glossar-Entscheidungen und Sichtbarkeit in Suchmaschinen dürfen nicht verschwinden, nur weil sich ein Abonnement ändert.",
              "Deepglot folgt deshalb einem klaren Prinzip: Übersetzungen bleiben für das Projekt zugänglich, lassen sich exportieren und können über die WordPress-Integration ausgeliefert werden, ohne jeden Seitenaufruf zu einem neuen Übersetzungskauf zu machen.",
            ],
          },
          {
            heading: "Wahlfreiheit beim KI-Provider",
            paragraphs: [
              "Websites unterscheiden sich bei Qualitätsanspruch, Kostenprofil und Datenschutzgrenzen. Deepglot unterstützt mehrere Provider und kompatible Gateways, damit der Publishing-Prozess nicht dauerhaft an einen einzelnen Modellanbieter gebunden ist.",
              "Diese Offenheit ermöglicht auch einen selbst gehosteten Weg für Teams, die Infrastruktur und Datenverarbeitung noch stärker kontrollieren müssen.",
            ],
          },
          {
            heading: "Ein WordPress-first-Workflow",
            paragraphs: [
              "Das Plugin übersetzt die gerenderte Website, hält Ergebnisse nahe an WordPress im Cache und unterstützt mehrsprachige Routen sowie hreflang-Ausgaben. Redakteurinnen und Redakteure können Ergebnisse prüfen und korrigieren, statt maschinelle Ausgaben als unveränderlich zu behandeln.",
              "Das Ziel ist einfach: Mehrsprachig publizieren, ohne den bewährten Content-Prozess aus der Hand zu geben.",
            ],
          },
        ],
      },
    },
  },
  {
    id: "translated-slugs",
    slugs: {
      en: "translated-url-slugs-for-wordpress",
      de: "uebersetzte-url-slugs-fuer-wordpress",
    },
    publishedAt: "2026-08-01",
    readingMinutes: 6,
    copy: {
      en: {
        title: "Translated URL slugs are part of the content",
        excerpt:
          "A practical look at localized routes, canonical URLs, hreflang, and why stable paths matter during a migration.",
        category: "WordPress engineering",
        sections: [
          {
            heading: "A URL carries meaning",
            paragraphs: [
              "Visitors and search engines read more than the text inside a page. A localized route communicates language, topic, and hierarchy before the page even renders.",
              "That is why Deepglot treats translated slugs as managed content rather than a cosmetic rewrite. A project can keep the language prefix, translated path segments, and the relationship back to the source URL together.",
            ],
          },
          {
            heading: "Stable routes make migrations safer",
            paragraphs: [
              "Replacing another translation system should not force a site to abandon URLs that have already been indexed or shared. Existing localized paths need to be inventoried, imported, and verified before traffic moves.",
              "The important boundary is the public URL: runtime configuration and routing must agree on the same mapping, while canonical and hreflang output must continue to describe the final destination correctly.",
            ],
          },
          {
            heading: "Verification belongs in the workflow",
            paragraphs: [
              "A successful import response is only the beginning. The durable check is a readback of the stored mappings, followed by requests to the public localized pages and inspection of their canonical and alternate-language links.",
              "That evidence-based sequence is slower than assuming success from one dialog, but it protects search visibility and prevents silent route drift.",
            ],
          },
        ],
      },
      de: {
        title: "Übersetzte URL-Slugs sind Teil des Inhalts",
        excerpt:
          "Ein praktischer Blick auf lokalisierte Routen, Canonicals, hreflang und stabile Pfade bei Migrationen.",
        category: "WordPress Engineering",
        sections: [
          {
            heading: "Eine URL transportiert Bedeutung",
            paragraphs: [
              "Besucher und Suchmaschinen lesen mehr als den Text innerhalb einer Seite. Eine lokalisierte Route vermittelt Sprache, Thema und Hierarchie, noch bevor die Seite gerendert wird.",
              "Deepglot behandelt übersetzte Slugs deshalb als verwalteten Inhalt und nicht als kosmetische Umschreibung. Sprachpräfix, übersetzte Pfadsegmente und die Beziehung zur Quell-URL bleiben gemeinsam nachvollziehbar.",
            ],
          },
          {
            heading: "Stabile Routen machen Migrationen sicherer",
            paragraphs: [
              "Der Wechsel von einem anderen Übersetzungssystem darf nicht bedeuten, dass bereits indexierte oder geteilte URLs aufgegeben werden. Bestehende lokalisierte Pfade müssen vor dem Umzug inventarisiert, importiert und geprüft werden.",
              "Entscheidend ist die öffentliche URL: Laufzeitkonfiguration und Routing müssen dieselbe Zuordnung verwenden, während Canonical- und hreflang-Ausgaben weiterhin korrekt auf das endgültige Ziel verweisen.",
            ],
          },
          {
            heading: "Verifikation gehört zum Ablauf",
            paragraphs: [
              "Eine erfolgreiche Import-Antwort ist erst der Anfang. Der belastbare Nachweis besteht aus dem erneuten Auslesen der gespeicherten Zuordnungen, gefolgt von Aufrufen der öffentlichen Sprachseiten und der Prüfung ihrer Canonical- und Sprachalternativen.",
              "Diese evidenzbasierte Abfolge dauert länger als ein vorschnelles Erfolgshäkchen, schützt dafür aber Sichtbarkeit und verhindert unbemerkte Routing-Abweichungen.",
            ],
          },
        ],
      },
    },
  },
  {
    id: "austria",
    slugs: {
      en: "built-in-austria-for-24-languages",
      de: "aus-oesterreich-fuer-24-sprachen",
    },
    publishedAt: "2026-08-01",
    readingMinutes: 4,
    copy: {
      en: {
        title: "Built in Austria, designed for 24 languages",
        excerpt:
          "How regional identity and multilingual ambition can strengthen each other in one product experience.",
        category: "Inside Deepglot",
        sections: [
          {
            heading: "A clear place of origin",
            paragraphs: [
              "Deepglot is developed in Austria. That origin now has a visible place in the product: direct language, precise interfaces, a warm architectural image, and a signal orange that is distinctly its own.",
              "Regional character does not mean decorating every screen with clichés. It means being specific about who builds the product, where responsibility sits, and how customers can reach the people behind it.",
            ],
          },
          {
            heading: "The selected language takes the lead",
            paragraphs: [
              "The homepage is available in 24 languages. Instead of making one city the permanent center of the story, the selected language becomes the starting point and branches into the live website showcase.",
              "Austria remains the product’s origin; the visitor’s language becomes the product’s focus. Both ideas can coexist without competing for attention.",
            ],
          },
          {
            heading: "Open source makes the promise inspectable",
            paragraphs: [
              "The visual identity supports a product principle: claims about control are stronger when the implementation can be inspected. Deepglot’s open-source repository makes the WordPress integration and application decisions visible.",
              "Personality, place, and technical openness now tell the same story—from the favicon to the dashboard and the blog you are reading now.",
            ],
          },
        ],
      },
      de: {
        title: "Aus Österreich, gemacht für 24 Sprachen",
        excerpt:
          "Wie regionale Identität und mehrsprachiger Anspruch in einem Produkterlebnis zusammenwirken.",
        category: "Inside Deepglot",
        sections: [
          {
            heading: "Ein klarer Herkunftsort",
            paragraphs: [
              "Deepglot wird in Österreich entwickelt. Diese Herkunft erhält nun einen sichtbaren Platz im Produkt: direkte Sprache, präzise Oberflächen, ein warmes Architekturbild und ein eigenständiges Signalorange.",
              "Regionaler Charakter bedeutet nicht, jede Oberfläche mit Klischees zu dekorieren. Er bedeutet, klar zu zeigen, wer das Produkt baut, wo Verantwortung liegt und wie Kunden die Menschen dahinter erreichen.",
            ],
          },
          {
            heading: "Die gewählte Sprache steht im Mittelpunkt",
            paragraphs: [
              "Die Startseite ist in 24 Sprachen verfügbar. Statt eine einzelne Stadt dauerhaft ins Zentrum der Geschichte zu stellen, wird die gewählte Sprache zum Ausgangspunkt und verzweigt sich in das interaktive Website-Showcase.",
              "Österreich bleibt die Herkunft des Produkts; die Sprache des Besuchers wird zum Fokus. Beide Ideen ergänzen einander, ohne um Aufmerksamkeit zu konkurrieren.",
            ],
          },
          {
            heading: "Open Source macht das Versprechen prüfbar",
            paragraphs: [
              "Die visuelle Identität unterstützt ein Produktprinzip: Aussagen über Kontrolle sind stärker, wenn sich die Umsetzung prüfen lässt. Das Open-Source-Repository von Deepglot macht die WordPress-Integration und Produktentscheidungen sichtbar.",
              "Persönlichkeit, Herkunft und technische Offenheit erzählen nun dieselbe Geschichte – vom Favicon über das Dashboard bis zu diesem Blog.",
            ],
          },
        ],
      },
    },
  },
] as const;

function getLocalizedSlug(source: BlogPostSource, locale: SiteLocale) {
  return locale === "de" ? source.slugs.de : source.slugs.en;
}

function localizeBlogPost(source: BlogPostSource, locale: SiteLocale): BlogPost {
  return {
    id: source.id,
    slug: getLocalizedSlug(source, locale),
    publishedAt: source.publishedAt,
    readingMinutes: source.readingMinutes,
    copy: locale === "de" ? source.copy.de : source.copy.en,
  };
}

export function getBlogPosts(locale: SiteLocale) {
  return BLOG_POSTS.map((source) => localizeBlogPost(source, locale));
}

export function getBlogPost(locale: SiteLocale, slug: string) {
  const source = BLOG_POSTS.find(
    (candidate) => candidate.slugs.en === slug || candidate.slugs.de === slug
  );

  return source ? localizeBlogPost(source, locale) : null;
}

export function getBlogArticlePath(locale: SiteLocale, slug: string) {
  return withLocalePrefix(`/blog/${slug}`, locale);
}

export function formatBlogDate(locale: SiteLocale, publishedAt: string) {
  return new Intl.DateTimeFormat(SITE_LOCALE_METADATA[locale].intlLocale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${publishedAt}T00:00:00Z`));
}

export function getAllBlogSlugs() {
  return BLOG_POSTS.flatMap((source) => [source.slugs.en, source.slugs.de]);
}
