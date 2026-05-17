export const SITE_LOCALE_COOKIE = "deepglot-locale";

export const SITE_LOCALES = [
  "en",
  "bg",
  "hr",
  "cs",
  "da",
  "nl",
  "et",
  "fi",
  "fr",
  "de",
  "el",
  "hu",
  "ga",
  "it",
  "lv",
  "lt",
  "mt",
  "pl",
  "pt",
  "ro",
  "sk",
  "sl",
  "es",
  "sv",
] as const;

export type SiteLocale = (typeof SITE_LOCALES)[number];

export const DEFAULT_MARKETING_LOCALE: SiteLocale = "en";

export const SITE_LOCALE_METADATA: Record<
  SiteLocale,
  {
    nativeName: string;
    englishName: string;
    shortLabel: string;
    intlLocale: string;
    openGraphLocale: string;
  }
> = {
  en: {
    nativeName: "English",
    englishName: "English",
    shortLabel: "EN",
    intlLocale: "en-US",
    openGraphLocale: "en_US",
  },
  bg: {
    nativeName: "Български",
    englishName: "Bulgarian",
    shortLabel: "BG",
    intlLocale: "bg-BG",
    openGraphLocale: "bg_BG",
  },
  hr: {
    nativeName: "Hrvatski",
    englishName: "Croatian",
    shortLabel: "HR",
    intlLocale: "hr-HR",
    openGraphLocale: "hr_HR",
  },
  cs: {
    nativeName: "Čeština",
    englishName: "Czech",
    shortLabel: "CS",
    intlLocale: "cs-CZ",
    openGraphLocale: "cs_CZ",
  },
  da: {
    nativeName: "Dansk",
    englishName: "Danish",
    shortLabel: "DA",
    intlLocale: "da-DK",
    openGraphLocale: "da_DK",
  },
  nl: {
    nativeName: "Nederlands",
    englishName: "Dutch",
    shortLabel: "NL",
    intlLocale: "nl-NL",
    openGraphLocale: "nl_NL",
  },
  et: {
    nativeName: "Eesti",
    englishName: "Estonian",
    shortLabel: "ET",
    intlLocale: "et-EE",
    openGraphLocale: "et_EE",
  },
  fi: {
    nativeName: "Suomi",
    englishName: "Finnish",
    shortLabel: "FI",
    intlLocale: "fi-FI",
    openGraphLocale: "fi_FI",
  },
  fr: {
    nativeName: "Français",
    englishName: "French",
    shortLabel: "FR",
    intlLocale: "fr-FR",
    openGraphLocale: "fr_FR",
  },
  de: {
    nativeName: "Deutsch",
    englishName: "German",
    shortLabel: "DE",
    intlLocale: "de-DE",
    openGraphLocale: "de_DE",
  },
  el: {
    nativeName: "Ελληνικά",
    englishName: "Greek",
    shortLabel: "EL",
    intlLocale: "el-GR",
    openGraphLocale: "el_GR",
  },
  hu: {
    nativeName: "Magyar",
    englishName: "Hungarian",
    shortLabel: "HU",
    intlLocale: "hu-HU",
    openGraphLocale: "hu_HU",
  },
  ga: {
    nativeName: "Gaeilge",
    englishName: "Irish",
    shortLabel: "GA",
    intlLocale: "ga-IE",
    openGraphLocale: "ga_IE",
  },
  it: {
    nativeName: "Italiano",
    englishName: "Italian",
    shortLabel: "IT",
    intlLocale: "it-IT",
    openGraphLocale: "it_IT",
  },
  lv: {
    nativeName: "Latviešu",
    englishName: "Latvian",
    shortLabel: "LV",
    intlLocale: "lv-LV",
    openGraphLocale: "lv_LV",
  },
  lt: {
    nativeName: "Lietuvių",
    englishName: "Lithuanian",
    shortLabel: "LT",
    intlLocale: "lt-LT",
    openGraphLocale: "lt_LT",
  },
  mt: {
    nativeName: "Malti",
    englishName: "Maltese",
    shortLabel: "MT",
    intlLocale: "mt-MT",
    openGraphLocale: "mt_MT",
  },
  pl: {
    nativeName: "Polski",
    englishName: "Polish",
    shortLabel: "PL",
    intlLocale: "pl-PL",
    openGraphLocale: "pl_PL",
  },
  pt: {
    nativeName: "Português",
    englishName: "Portuguese",
    shortLabel: "PT",
    intlLocale: "pt-PT",
    openGraphLocale: "pt_PT",
  },
  ro: {
    nativeName: "Română",
    englishName: "Romanian",
    shortLabel: "RO",
    intlLocale: "ro-RO",
    openGraphLocale: "ro_RO",
  },
  sk: {
    nativeName: "Slovenčina",
    englishName: "Slovak",
    shortLabel: "SK",
    intlLocale: "sk-SK",
    openGraphLocale: "sk_SK",
  },
  sl: {
    nativeName: "Slovenščina",
    englishName: "Slovenian",
    shortLabel: "SL",
    intlLocale: "sl-SI",
    openGraphLocale: "sl_SI",
  },
  es: {
    nativeName: "Español",
    englishName: "Spanish",
    shortLabel: "ES",
    intlLocale: "es-ES",
    openGraphLocale: "es_ES",
  },
  sv: {
    nativeName: "Svenska",
    englishName: "Swedish",
    shortLabel: "SV",
    intlLocale: "sv-SE",
    openGraphLocale: "sv_SE",
  },
};

const SITE_LOCALE_SET = new Set<string>(SITE_LOCALES);

const INTERNAL_SEGMENTS = {
  pricing: "pricing",
  docs: "docs",
  login: "login",
  signup: "signup",
  forgotPassword: "forgot-password",
  resetPassword: "reset-password",
  acceptInvite: "accept-invite",
  privacy: "datenschutz",
  legalNotice: "impressum",
  terms: "agb",
  dashboard: "dashboard",
  projects: "projekte",
  new: "neu",
  translations: "uebersetzungen",
  languages: "sprachen",
  glossary: "glossar",
  visual: "visuell",
  pros: "profis",
  stats: "statistiken",
  requests: "anfragen",
  pageViews: "seitenaufrufe",
  settings: "einstellungen",
  languageModel: "sprachmodell",
  exclusions: "ausnahmen",
  members: "mitglieder",
  subscription: "abonnement",
  overview: "uebersicht",
  billing: "karte-rechnungen",
  usage: "nutzung",
  apiKeys: "api-keys",
  importExport: "import-export",
  setup: "setup",
  wordpress: "wordpress",
  webhooks: "webhooks",
} as const;

type SegmentKey = keyof typeof INTERNAL_SEGMENTS;

const LOCALIZED_SEGMENTS: Record<SiteLocale, Record<SegmentKey, string>> = {
  en: {
    pricing: "pricing",
    docs: "docs",
    login: "login",
    signup: "signup",
    forgotPassword: "forgot-password",
    resetPassword: "reset-password",
    acceptInvite: "accept-invite",
    privacy: "privacy",
    legalNotice: "legal-notice",
    terms: "terms",
    dashboard: "dashboard",
    projects: "projects",
    new: "new",
    translations: "translations",
    languages: "languages",
    glossary: "glossary",
    visual: "visual",
    pros: "pros",
    stats: "stats",
    requests: "requests",
    pageViews: "page-views",
    settings: "settings",
    languageModel: "language-model",
    exclusions: "exclusions",
    members: "members",
    subscription: "subscription",
    overview: "overview",
    billing: "billing",
    usage: "usage",
    apiKeys: "api-keys",
    importExport: "import-export",
    setup: "setup",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  bg: {
    pricing: "цени",
    docs: "документация",
    login: "вход",
    signup: "регистрация",
    forgotPassword: "забравена-парола",
    resetPassword: "нова-парола",
    acceptInvite: "приемане-на-покана",
    privacy: "поверителност",
    legalNotice: "правна-информация",
    terms: "условия",
    dashboard: "табло",
    projects: "проекти",
    new: "нов",
    translations: "преводи",
    languages: "езици",
    glossary: "речник",
    visual: "визуален",
    pros: "професионалисти",
    stats: "статистики",
    requests: "заявки",
    pageViews: "прегледи-на-страници",
    settings: "настройки",
    languageModel: "езиков-модел",
    exclusions: "изключения",
    members: "членове",
    subscription: "абонамент",
    overview: "преглед",
    billing: "фактуриране",
    usage: "използване",
    apiKeys: "api-ключове",
    importExport: "импорт-експорт",
    setup: "настройка",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  hr: {
    pricing: "cijene",
    docs: "dokumentacija",
    login: "prijava",
    signup: "registracija",
    forgotPassword: "zaboravljena-lozinka",
    resetPassword: "nova-lozinka",
    acceptInvite: "prihvati-pozivnicu",
    privacy: "privatnost",
    legalNotice: "pravna-obavijest",
    terms: "uvjeti",
    dashboard: "nadzorna-ploca",
    projects: "projekti",
    new: "novo",
    translations: "prijevodi",
    languages: "jezici",
    glossary: "glosar",
    visual: "vizualno",
    pros: "strucnjaci",
    stats: "statistika",
    requests: "zahtjevi",
    pageViews: "pregledi-stranica",
    settings: "postavke",
    languageModel: "jezicni-model",
    exclusions: "izuzeci",
    members: "clanovi",
    subscription: "pretplata",
    overview: "pregled",
    billing: "naplata",
    usage: "koristenje",
    apiKeys: "api-kljucevi",
    importExport: "uvoz-izvoz",
    setup: "postavljanje",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  cs: {
    pricing: "ceny",
    docs: "dokumentace",
    login: "prihlaseni",
    signup: "registrace",
    forgotPassword: "zapomenute-heslo",
    resetPassword: "nove-heslo",
    acceptInvite: "prijmout-pozvanku",
    privacy: "soukromi",
    legalNotice: "pravni-informace",
    terms: "podminky",
    dashboard: "prehled",
    projects: "projekty",
    new: "novy",
    translations: "preklady",
    languages: "jazyky",
    glossary: "slovnik",
    visual: "vizualni",
    pros: "profesionalove",
    stats: "statistiky",
    requests: "pozadavky",
    pageViews: "zobrazeni-stranek",
    settings: "nastaveni",
    languageModel: "jazykovy-model",
    exclusions: "vylouceni",
    members: "clenove",
    subscription: "predplatne",
    overview: "souhrn",
    billing: "fakturace",
    usage: "vyuziti",
    apiKeys: "api-klice",
    importExport: "import-export",
    setup: "konfigurace",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  da: {
    pricing: "priser",
    docs: "dokumentation",
    login: "log-ind",
    signup: "opret-konto",
    forgotPassword: "glemt-adgangskode",
    resetPassword: "ny-adgangskode",
    acceptInvite: "accepter-invitation",
    privacy: "privatliv",
    legalNotice: "juridisk-meddelelse",
    terms: "vilkar",
    dashboard: "dashboard",
    projects: "projekter",
    new: "ny",
    translations: "oversaettelser",
    languages: "sprog",
    glossary: "ordliste",
    visual: "visuel",
    pros: "professionelle",
    stats: "statistik",
    requests: "anmodninger",
    pageViews: "sidevisninger",
    settings: "indstillinger",
    languageModel: "sprogmodel",
    exclusions: "undtagelser",
    members: "medlemmer",
    subscription: "abonnement",
    overview: "oversigt",
    billing: "fakturering",
    usage: "forbrug",
    apiKeys: "api-nogler",
    importExport: "import-export",
    setup: "opsaetning",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  nl: {
    pricing: "prijzen",
    docs: "documentatie",
    login: "inloggen",
    signup: "registreren",
    forgotPassword: "wachtwoord-vergeten",
    resetPassword: "nieuw-wachtwoord",
    acceptInvite: "uitnodiging-accepteren",
    privacy: "privacy",
    legalNotice: "juridische-kennisgeving",
    terms: "voorwaarden",
    dashboard: "dashboard",
    projects: "projecten",
    new: "nieuw",
    translations: "vertalingen",
    languages: "talen",
    glossary: "woordenlijst",
    visual: "visueel",
    pros: "professionals",
    stats: "statistieken",
    requests: "aanvragen",
    pageViews: "paginaweergaven",
    settings: "instellingen",
    languageModel: "taalmodel",
    exclusions: "uitsluitingen",
    members: "leden",
    subscription: "abonnement",
    overview: "overzicht",
    billing: "facturatie",
    usage: "gebruik",
    apiKeys: "api-sleutels",
    importExport: "import-export",
    setup: "installatie",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  et: {
    pricing: "hinnad",
    docs: "dokumentatsioon",
    login: "sisselogimine",
    signup: "registreeru",
    forgotPassword: "unustatud-parool",
    resetPassword: "uus-parool",
    acceptInvite: "nouste-kutsega",
    privacy: "privaatsus",
    legalNotice: "oiguslik-teave",
    terms: "tingimused",
    dashboard: "toolaud",
    projects: "projektid",
    new: "uus",
    translations: "tolked",
    languages: "keeled",
    glossary: "sonastik",
    visual: "visuaalne",
    pros: "professionaalid",
    stats: "statistika",
    requests: "paringud",
    pageViews: "lehevaatamised",
    settings: "seaded",
    languageModel: "keelemudel",
    exclusions: "valistused",
    members: "liikmed",
    subscription: "tellimus",
    overview: "ulevaade",
    billing: "arveldus",
    usage: "kasutus",
    apiKeys: "api-votmed",
    importExport: "import-export",
    setup: "seadistus",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  fi: {
    pricing: "hinnat",
    docs: "dokumentaatio",
    login: "kirjaudu",
    signup: "rekisteroidy",
    forgotPassword: "unohtunut-salasana",
    resetPassword: "uusi-salasana",
    acceptInvite: "hyvaksy-kutsu",
    privacy: "tietosuoja",
    legalNotice: "oikeudellinen-ilmoitus",
    terms: "ehdot",
    dashboard: "hallintapaneeli",
    projects: "projektit",
    new: "uusi",
    translations: "kaannokset",
    languages: "kielet",
    glossary: "sanasto",
    visual: "visuaalinen",
    pros: "ammattilaiset",
    stats: "tilastot",
    requests: "pyynnot",
    pageViews: "sivunakyma",
    settings: "asetukset",
    languageModel: "kielimalli",
    exclusions: "poissulut",
    members: "jasenet",
    subscription: "tilaus",
    overview: "yleiskatsaus",
    billing: "laskutus",
    usage: "kaytto",
    apiKeys: "api-avaimet",
    importExport: "tuonti-vienti",
    setup: "asennus",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  fr: {
    pricing: "tarifs",
    docs: "documentation",
    login: "connexion",
    signup: "inscription",
    forgotPassword: "mot-de-passe-oublie",
    resetPassword: "nouveau-mot-de-passe",
    acceptInvite: "accepter-invitation",
    privacy: "confidentialite",
    legalNotice: "mentions-legales",
    terms: "conditions",
    dashboard: "tableau-de-bord",
    projects: "projets",
    new: "nouveau",
    translations: "traductions",
    languages: "langues",
    glossary: "glossaire",
    visual: "visuel",
    pros: "pros",
    stats: "statistiques",
    requests: "requetes",
    pageViews: "pages-vues",
    settings: "parametres",
    languageModel: "modele-de-langue",
    exclusions: "exclusions",
    members: "membres",
    subscription: "abonnement",
    overview: "apercu",
    billing: "facturation",
    usage: "utilisation",
    apiKeys: "cles-api",
    importExport: "import-export",
    setup: "configuration",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  de: {
    pricing: "preise",
    docs: "dokumentation",
    login: "anmelden",
    signup: "registrieren",
    forgotPassword: "passwort-vergessen",
    resetPassword: "passwort-zuruecksetzen",
    acceptInvite: "einladung-annehmen",
    privacy: "datenschutz",
    legalNotice: "impressum",
    terms: "agb",
    dashboard: "dashboard",
    projects: "projekte",
    new: "neu",
    translations: "uebersetzungen",
    languages: "sprachen",
    glossary: "glossar",
    visual: "visuell",
    pros: "profis",
    stats: "statistiken",
    requests: "anfragen",
    pageViews: "seitenaufrufe",
    settings: "einstellungen",
    languageModel: "sprachmodell",
    exclusions: "ausnahmen",
    members: "mitglieder",
    subscription: "abonnement",
    overview: "uebersicht",
    billing: "karte-rechnungen",
    usage: "nutzung",
    apiKeys: "api-keys",
    importExport: "import-export",
    setup: "setup",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  el: {
    pricing: "τιμες",
    docs: "τεκμηριωση",
    login: "συνδεση",
    signup: "εγγραφη",
    forgotPassword: "ξεχασατε-κωδικο",
    resetPassword: "νεος-κωδικος",
    acceptInvite: "αποδοχη-προσκλησης",
    privacy: "απορρητο",
    legalNotice: "νομικη-ειδοποιηση",
    terms: "οροι",
    dashboard: "πινακας",
    projects: "εργα",
    new: "νεο",
    translations: "μεταφρασεις",
    languages: "γλωσσες",
    glossary: "γλωσσαριο",
    visual: "οπτικο",
    pros: "ειδικοι",
    stats: "στατιστικα",
    requests: "αιτηματα",
    pageViews: "προβολες-σελιδων",
    settings: "ρυθμισεις",
    languageModel: "γλωσσικο-μοντελο",
    exclusions: "εξαιρεσεις",
    members: "μελη",
    subscription: "συνδρομη",
    overview: "επισκοπηση",
    billing: "χρεωση",
    usage: "χρηση",
    apiKeys: "κλειδια-api",
    importExport: "εισαγωγη-εξαγωγη",
    setup: "ρυθμιση",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  hu: {
    pricing: "arak",
    docs: "dokumentacio",
    login: "bejelentkezes",
    signup: "regisztracio",
    forgotPassword: "elfelejtett-jelszo",
    resetPassword: "uj-jelszo",
    acceptInvite: "meghivo-elfogadasa",
    privacy: "adatvedelem",
    legalNotice: "jogi-kozlemeny",
    terms: "feltetelek",
    dashboard: "vezerlopult",
    projects: "projektek",
    new: "uj",
    translations: "forditasok",
    languages: "nyelvek",
    glossary: "szotar",
    visual: "vizualis",
    pros: "profik",
    stats: "statisztikak",
    requests: "keresek",
    pageViews: "oldalmegtekintesek",
    settings: "beallitasok",
    languageModel: "nyelvi-modell",
    exclusions: "kizart-elemek",
    members: "tagok",
    subscription: "elofizetes",
    overview: "attekintes",
    billing: "szamlazas",
    usage: "hasznalat",
    apiKeys: "api-kulcsok",
    importExport: "import-export",
    setup: "beallitas",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  ga: {
    pricing: "praghsanna",
    docs: "doicimeadacht",
    login: "logail-isteach",
    signup: "claru",
    forgotPassword: "focal-faire-dearmadta",
    resetPassword: "focal-faire-nua",
    acceptInvite: "glac-cuireadh",
    privacy: "priobhaideachas",
    legalNotice: "fogra-dlithiuil",
    terms: "tearmai",
    dashboard: "deais",
    projects: "tionscadail",
    new: "nua",
    translations: "aistriuchain",
    languages: "teangacha",
    glossary: "gluais",
    visual: "amhairc",
    pros: "gairmithe",
    stats: "staitistici",
    requests: "iarratais",
    pageViews: "amharcanna-leathanaigh",
    settings: "socruithe",
    languageModel: "samhlacha-teanga",
    exclusions: "eisiaimh",
    members: "baill",
    subscription: "sintiús",
    overview: "forbhreathnu",
    billing: "billeail",
    usage: "usaid",
    apiKeys: "eochracha-api",
    importExport: "iompórtáil-easpórtáil",
    setup: "socru",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  it: {
    pricing: "prezzi",
    docs: "documentazione",
    login: "accesso",
    signup: "registrazione",
    forgotPassword: "password-dimenticata",
    resetPassword: "nuova-password",
    acceptInvite: "accetta-invito",
    privacy: "privacy",
    legalNotice: "note-legali",
    terms: "termini",
    dashboard: "dashboard",
    projects: "progetti",
    new: "nuovo",
    translations: "traduzioni",
    languages: "lingue",
    glossary: "glossario",
    visual: "visuale",
    pros: "professionisti",
    stats: "statistiche",
    requests: "richieste",
    pageViews: "visualizzazioni-pagina",
    settings: "impostazioni",
    languageModel: "modello-linguistico",
    exclusions: "esclusioni",
    members: "membri",
    subscription: "abbonamento",
    overview: "panoramica",
    billing: "fatturazione",
    usage: "utilizzo",
    apiKeys: "chiavi-api",
    importExport: "import-export",
    setup: "configurazione",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  lv: {
    pricing: "cenas",
    docs: "dokumentacija",
    login: "pieslegties",
    signup: "registracija",
    forgotPassword: "aizmirsta-parole",
    resetPassword: "jauna-parole",
    acceptInvite: "pienemt-uzaicinajumu",
    privacy: "privatums",
    legalNotice: "juridiska-informacija",
    terms: "noteikumi",
    dashboard: "panelis",
    projects: "projekti",
    new: "jauns",
    translations: "tulkojumi",
    languages: "valodas",
    glossary: "vardnica",
    visual: "vizuals",
    pros: "profesionali",
    stats: "statistika",
    requests: "pieprasijumi",
    pageViews: "lapu-skatijumi",
    settings: "iestatijumi",
    languageModel: "valodas-modelis",
    exclusions: "iznemumi",
    members: "dalibnieki",
    subscription: "abonements",
    overview: "parskats",
    billing: "reikini",
    usage: "lietojums",
    apiKeys: "api-atslegas",
    importExport: "imports-eksports",
    setup: "iestatisana",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  lt: {
    pricing: "kainos",
    docs: "dokumentacija",
    login: "prisijungimas",
    signup: "registracija",
    forgotPassword: "pamirstas-slaptazodis",
    resetPassword: "naujas-slaptazodis",
    acceptInvite: "priimti-kvietima",
    privacy: "privatumas",
    legalNotice: "teisine-informacija",
    terms: "salygos",
    dashboard: "skydelis",
    projects: "projektai",
    new: "naujas",
    translations: "vertimai",
    languages: "kalbos",
    glossary: "zodynas",
    visual: "vizualus",
    pros: "profesionalai",
    stats: "statistika",
    requests: "uzklausos",
    pageViews: "puslapiu-perziuros",
    settings: "nustatymai",
    languageModel: "kalbos-modelis",
    exclusions: "isimtys",
    members: "nariai",
    subscription: "prenumerata",
    overview: "apzvalga",
    billing: "atsiskaitymas",
    usage: "naudojimas",
    apiKeys: "api-raktai",
    importExport: "importas-eksportas",
    setup: "sarasymas",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  mt: {
    pricing: "prezzijiet",
    docs: "dokumentazzjoni",
    login: "idhol",
    signup: "irreġistra",
    forgotPassword: "password-minsija",
    resetPassword: "password-gdida",
    acceptInvite: "accetta-stedina",
    privacy: "privatezza",
    legalNotice: "avviz-legali",
    terms: "termini",
    dashboard: "dashboard",
    projects: "progetti",
    new: "gdid",
    translations: "traduzzjonijiet",
    languages: "lingwi",
    glossary: "glossarju",
    visual: "vizwali",
    pros: "professjonisti",
    stats: "statistika",
    requests: "talbiet",
    pageViews: "dehriet-tal-pagna",
    settings: "settings",
    languageModel: "mudell-tal-lingwa",
    exclusions: "eskluzjonijiet",
    members: "membri",
    subscription: "abbonament",
    overview: "harsa-generali",
    billing: "fatturazzjoni",
    usage: "uzu",
    apiKeys: "api-keys",
    importExport: "import-export",
    setup: "setup",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  pl: {
    pricing: "cennik",
    docs: "dokumentacja",
    login: "logowanie",
    signup: "rejestracja",
    forgotPassword: "zapomniane-haslo",
    resetPassword: "nowe-haslo",
    acceptInvite: "zaakceptuj-zaproszenie",
    privacy: "prywatnosc",
    legalNotice: "nota-prawna",
    terms: "warunki",
    dashboard: "panel",
    projects: "projekty",
    new: "nowy",
    translations: "tlumaczenia",
    languages: "jezyki",
    glossary: "slownik",
    visual: "wizualny",
    pros: "profesjonalisci",
    stats: "statystyki",
    requests: "zapytania",
    pageViews: "wyswietlenia-stron",
    settings: "ustawienia",
    languageModel: "model-jezykowy",
    exclusions: "wykluczenia",
    members: "czlonkowie",
    subscription: "subskrypcja",
    overview: "przeglad",
    billing: "rozliczenia",
    usage: "uzycie",
    apiKeys: "klucze-api",
    importExport: "import-export",
    setup: "konfiguracja",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  pt: {
    pricing: "precos",
    docs: "documentacao",
    login: "entrar",
    signup: "registar",
    forgotPassword: "palavra-passe-esquecida",
    resetPassword: "nova-palavra-passe",
    acceptInvite: "aceitar-convite",
    privacy: "privacidade",
    legalNotice: "aviso-legal",
    terms: "termos",
    dashboard: "painel",
    projects: "projetos",
    new: "novo",
    translations: "traducoes",
    languages: "idiomas",
    glossary: "glossario",
    visual: "visual",
    pros: "profissionais",
    stats: "estatisticas",
    requests: "pedidos",
    pageViews: "visualizacoes-de-pagina",
    settings: "definicoes",
    languageModel: "modelo-de-linguagem",
    exclusions: "exclusoes",
    members: "membros",
    subscription: "subscricao",
    overview: "visao-geral",
    billing: "faturacao",
    usage: "utilizacao",
    apiKeys: "chaves-api",
    importExport: "import-export",
    setup: "configuracao",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  ro: {
    pricing: "preturi",
    docs: "documentatie",
    login: "autentificare",
    signup: "inregistrare",
    forgotPassword: "parola-uitata",
    resetPassword: "parola-noua",
    acceptInvite: "accepta-invitatia",
    privacy: "confidentialitate",
    legalNotice: "aviz-legal",
    terms: "termeni",
    dashboard: "panou",
    projects: "proiecte",
    new: "nou",
    translations: "traduceri",
    languages: "limbi",
    glossary: "glosar",
    visual: "vizual",
    pros: "profesionisti",
    stats: "statistici",
    requests: "cereri",
    pageViews: "vizualizari-pagini",
    settings: "setari",
    languageModel: "model-lingvistic",
    exclusions: "excluderi",
    members: "membri",
    subscription: "abonament",
    overview: "prezentare-generala",
    billing: "facturare",
    usage: "utilizare",
    apiKeys: "chei-api",
    importExport: "import-export",
    setup: "configurare",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  sk: {
    pricing: "ceny",
    docs: "dokumentacia",
    login: "prihlasenie",
    signup: "registracia",
    forgotPassword: "zabudnute-heslo",
    resetPassword: "nove-heslo",
    acceptInvite: "prijat-pozvanku",
    privacy: "sukromie",
    legalNotice: "pravne-oznamenie",
    terms: "podmienky",
    dashboard: "prehlad",
    projects: "projekty",
    new: "novy",
    translations: "preklady",
    languages: "jazyky",
    glossary: "slovnik",
    visual: "vizualne",
    pros: "profesionali",
    stats: "statistiky",
    requests: "poziadavky",
    pageViews: "zobrazenia-stranok",
    settings: "nastavenia",
    languageModel: "jazykovy-model",
    exclusions: "vynimky",
    members: "clenovia",
    subscription: "predplatne",
    overview: "suhrn",
    billing: "fakturacia",
    usage: "pouzitie",
    apiKeys: "api-kluce",
    importExport: "import-export",
    setup: "nastavenie",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  sl: {
    pricing: "cene",
    docs: "dokumentacija",
    login: "prijava",
    signup: "registracija",
    forgotPassword: "pozabljeno-geslo",
    resetPassword: "novo-geslo",
    acceptInvite: "sprejmi-povabilo",
    privacy: "zasebnost",
    legalNotice: "pravni-pouk",
    terms: "pogoji",
    dashboard: "nadzorna-plosca",
    projects: "projekti",
    new: "nov",
    translations: "prevodi",
    languages: "jeziki",
    glossary: "slovar",
    visual: "vizualno",
    pros: "strokovnjaki",
    stats: "statistika",
    requests: "zahteve",
    pageViews: "ogledi-strani",
    settings: "nastavitve",
    languageModel: "jezikovni-model",
    exclusions: "izkljucitve",
    members: "clani",
    subscription: "narocnina",
    overview: "pregled",
    billing: "obracunavanje",
    usage: "uporaba",
    apiKeys: "api-kljuci",
    importExport: "uvoz-izvoz",
    setup: "nastavitev",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  es: {
    pricing: "precios",
    docs: "documentacion",
    login: "iniciar-sesion",
    signup: "registro",
    forgotPassword: "contrasena-olvidada",
    resetPassword: "nueva-contrasena",
    acceptInvite: "aceptar-invitacion",
    privacy: "privacidad",
    legalNotice: "aviso-legal",
    terms: "terminos",
    dashboard: "panel",
    projects: "proyectos",
    new: "nuevo",
    translations: "traducciones",
    languages: "idiomas",
    glossary: "glosario",
    visual: "visual",
    pros: "profesionales",
    stats: "estadisticas",
    requests: "solicitudes",
    pageViews: "vistas-de-pagina",
    settings: "configuracion",
    languageModel: "modelo-de-lenguaje",
    exclusions: "exclusiones",
    members: "miembros",
    subscription: "suscripcion",
    overview: "resumen",
    billing: "facturacion",
    usage: "uso",
    apiKeys: "claves-api",
    importExport: "import-export",
    setup: "instalacion",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
  sv: {
    pricing: "priser",
    docs: "dokumentation",
    login: "logga-in",
    signup: "registrera",
    forgotPassword: "glomt-losenord",
    resetPassword: "nytt-losenord",
    acceptInvite: "acceptera-inbjudan",
    privacy: "integritet",
    legalNotice: "juridiskt-meddelande",
    terms: "villkor",
    dashboard: "instrumentpanel",
    projects: "projekt",
    new: "ny",
    translations: "oversattningar",
    languages: "sprak",
    glossary: "ordlista",
    visual: "visuell",
    pros: "proffs",
    stats: "statistik",
    requests: "forfragningar",
    pageViews: "sidvisningar",
    settings: "installningar",
    languageModel: "sprakmodell",
    exclusions: "undantag",
    members: "medlemmar",
    subscription: "prenumeration",
    overview: "oversikt",
    billing: "fakturering",
    usage: "anvandning",
    apiKeys: "api-nycklar",
    importExport: "import-export",
    setup: "installation",
    wordpress: "wordpress",
    webhooks: "webhooks",
  },
};

const LEGACY_EXTERNAL_TO_INTERNAL_SEGMENT: Record<string, string> = {
  preise: INTERNAL_SEGMENTS.pricing,
  anmelden: INTERNAL_SEGMENTS.login,
  registrieren: INTERNAL_SEGMENTS.signup,
};

const GERMAN_LEGACY_ROOT_SEGMENTS = new Set(
  (Object.keys(INTERNAL_SEGMENTS) as SegmentKey[])
    .map((key) => LOCALIZED_SEGMENTS.de[key])
    .filter((segment, index) => {
      const key = (Object.keys(INTERNAL_SEGMENTS) as SegmentKey[])[index];
      return segment !== LOCALIZED_SEGMENTS.en[key];
    })
);

const LOCALIZED_SEGMENT_COLLISIONS = SITE_LOCALES.flatMap((locale) => {
  const seen = new Map<string, SegmentKey>();

  return (Object.keys(INTERNAL_SEGMENTS) as SegmentKey[]).flatMap((key) => {
    const segment = LOCALIZED_SEGMENTS[locale][key];
    const previousKey = seen.get(segment);
    seen.set(segment, key);

    return previousKey
      ? [`${locale}.${previousKey}/${key}: ${segment}`]
      : [];
  });
});

if (LOCALIZED_SEGMENT_COLLISIONS.length > 0) {
  throw new Error(
    `Duplicate localized route segments: ${LOCALIZED_SEGMENT_COLLISIONS.join(", ")}`
  );
}

export function isSiteLocale(value: string | null | undefined): value is SiteLocale {
  return typeof value === "string" && SITE_LOCALE_SET.has(value);
}

function getFirstSegment(pathname: string) {
  return pathname.split("/").filter(Boolean)[0] ?? "";
}

function buildExternalToInternalSegmentMap(locale: SiteLocale) {
  const localized = LOCALIZED_SEGMENTS[locale];
  const english = LOCALIZED_SEGMENTS.en;

  return Object.fromEntries(
    Object.entries(INTERNAL_SEGMENTS).flatMap(([key, internalSegment]) => {
      const segmentKey = key as SegmentKey;
      return [
        [localized[segmentKey], internalSegment],
        [english[segmentKey], internalSegment],
        [internalSegment, internalSegment],
      ];
    })
  ) as Record<string, string>;
}

function buildInternalToExternalSegmentMap(locale: SiteLocale) {
  const localized = LOCALIZED_SEGMENTS[locale];

  return Object.fromEntries(
    Object.entries(INTERNAL_SEGMENTS).map(([key, internalSegment]) => [
      internalSegment,
      localized[key as SegmentKey],
    ])
  ) as Record<string, string>;
}

function getExternalToInternalSegmentMap(locale: SiteLocale) {
  return {
    ...buildExternalToInternalSegmentMap(locale),
    ...LEGACY_EXTERNAL_TO_INTERNAL_SEGMENT,
  };
}

function getInternalToExternalSegmentMap(locale: SiteLocale) {
  return buildInternalToExternalSegmentMap(locale);
}

export function getDocumentLocale(pathname: string): SiteLocale {
  const firstSegment = getFirstSegment(pathname);
  return isSiteLocale(firstSegment) ? firstSegment : DEFAULT_MARKETING_LOCALE;
}

export function stripLocalePrefix(pathname: string) {
  const normalizedPathname = pathname || "/";
  const firstSegment = getFirstSegment(normalizedPathname);

  if (!isSiteLocale(firstSegment)) {
    return {
      locale: DEFAULT_MARKETING_LOCALE,
      pathname: normalizedPathname,
    };
  }

  const withoutLocale =
    normalizedPathname === `/${firstSegment}`
      ? "/"
      : normalizedPathname.slice(firstSegment.length + 1) || "/";

  return {
    locale: firstSegment,
    pathname: withoutLocale,
  };
}

function mapSegments(pathname: string, segmentMap: Record<string, string>) {
  if (pathname === "/") return "/";

  const mapped = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      const decodedSegment = safeDecodePathSegment(segment);
      return segmentMap[decodedSegment] ?? segmentMap[segment] ?? segment;
    });

  return `/${mapped.join("/")}`;
}

function decodePathSegments(pathname: string) {
  if (pathname === "/") return "/";

  const decoded = pathname
    .split("/")
    .filter(Boolean)
    .map(safeDecodePathSegment);

  return `/${decoded.join("/")}`;
}

function safeDecodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isNonLocalizedPath(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function toInternalPath(pathname: string) {
  const { locale, pathname: withoutLocale } = stripLocalePrefix(pathname);
  if (isNonLocalizedPath(withoutLocale)) {
    return withoutLocale;
  }
  return mapSegments(withoutLocale, getExternalToInternalSegmentMap(locale));
}

export function toCanonicalExternalPath(
  pathname: string,
  locale: SiteLocale = getDocumentLocale(pathname)
) {
  const internalPath = toInternalPath(pathname);
  if (isNonLocalizedPath(internalPath)) {
    return internalPath;
  }
  return mapSegments(internalPath, getInternalToExternalSegmentMap(locale));
}

export function withLocalePrefix(pathname: string, locale: SiteLocale) {
  const canonicalPath = toCanonicalExternalPath(pathname, locale);

  if (locale === DEFAULT_MARKETING_LOCALE) {
    return canonicalPath === "" ? "/" : canonicalPath;
  }

  if (canonicalPath === "/") {
    return `/${locale}`;
  }

  return `/${locale}${canonicalPath}`;
}

export function getLocalizedPathname(pathname: string, locale: SiteLocale) {
  return withLocalePrefix(pathname, locale);
}

export function getLegacyPublicRedirect(pathname: string) {
  const { locale, pathname: withoutLocale } = stripLocalePrefix(pathname);
  const firstSegment = getFirstSegment(withoutLocale);
  const legacyLocale =
    locale === DEFAULT_MARKETING_LOCALE && GERMAN_LEGACY_ROOT_SEGMENTS.has(firstSegment)
      ? "de"
      : locale;
  const canonicalBasePath = toCanonicalExternalPath(pathname, legacyLocale);
  const canonicalLocalizedPath = withLocalePrefix(canonicalBasePath, legacyLocale);
  const comparableWithoutLocale = decodePathSegments(withoutLocale);
  const currentLocalizedPath =
    locale === DEFAULT_MARKETING_LOCALE
      ? comparableWithoutLocale
      : comparableWithoutLocale === "/"
        ? `/${locale}`
        : `/${locale}${comparableWithoutLocale}`;

  if (canonicalLocalizedPath === currentLocalizedPath) {
    return null;
  }

  return canonicalLocalizedPath;
}

export function getMarketingPath(
  locale: SiteLocale,
  route:
    | "home"
    | "pricing"
    | "docs"
    | "login"
    | "signup"
    | "forgotPassword"
    | "resetPassword"
    | "acceptInvite"
    | "privacy"
    | "legalNotice"
    | "terms"
) {
  const localizedPaths = {
    home: "/",
    pricing: `/${LOCALIZED_SEGMENTS[locale].pricing}`,
    docs: `/${LOCALIZED_SEGMENTS[locale].docs}`,
    login: `/${LOCALIZED_SEGMENTS[locale].login}`,
    signup: `/${LOCALIZED_SEGMENTS[locale].signup}`,
    forgotPassword: `/${LOCALIZED_SEGMENTS[locale].forgotPassword}`,
    resetPassword: `/${LOCALIZED_SEGMENTS[locale].resetPassword}`,
    acceptInvite: `/${LOCALIZED_SEGMENTS[locale].acceptInvite}`,
    privacy: `/${LOCALIZED_SEGMENTS[locale].privacy}`,
    legalNotice: `/${LOCALIZED_SEGMENTS[locale].legalNotice}`,
    terms: `/${LOCALIZED_SEGMENTS[locale].terms}`,
  } as const;

  return withLocalePrefix(localizedPaths[route], locale);
}
