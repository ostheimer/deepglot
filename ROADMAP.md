# Deepglot – Roadmap

> Weglot-Alternative ohne Cloud-Lock-in: SaaS-Plattform + Self-hosted-Option  
> Stack: Next.js 15 · TypeScript · Tailwind CSS · shadcn/ui · NextAuth v5 · Neon (PostgreSQL) · Prisma · Stripe · DeepL API

---

## Architektur-Überblick

```
Next.js App (Vercel)          WordPress Plugin
├── Landing/Marketing    ←──  WP Plugin installieren
├── Auth (NextAuth v5)        ↓
├── Dashboard            ←──  API-Key aus Dashboard
│   ├── Projekte              ↓
│   ├── Übersetzungen    ←──  POST /api/translate
│   ├── API-Keys              ↓
│   └── Settings         ──→  Übersetzter HTML zurück
├── API Routes
│   ├── /api/translate   ←──  Plugin-Endpunkt
│   ├── /api/projects
│   └── /api/webhooks/stripe
└── Billing (Stripe)
```

---

## Phase 1 – Fundament (MVP)

| # | Aufgabe | Status |
|---|---|---|
| 1.1 | Next.js 16 Projekt initialisieren (TypeScript, App Router, Tailwind, shadcn/ui) | ✅ Abgeschlossen |
| 1.2 | Prisma Schema: User, Organization, Project, Translation, ApiKey, Subscription | ✅ Abgeschlossen |
| 1.3 | Neon PostgreSQL Adapter konfiguriert (Prisma 7 + @prisma/adapter-neon) | ✅ Abgeschlossen |
| 1.4 | NextAuth v5: Credentials + GitHub/Google OAuth | ✅ Abgeschlossen |
| 1.5 | Stripe Integration: Produkte, Webhook-Handler, Subscription-Management | ✅ Abgeschlossen |

---

## Phase 2 – Dashboard & Core Features

| # | Aufgabe | Status |
|---|---|---|
| 2.1 | Landing Page (Marketing, Pricing, Features) | ✅ Abgeschlossen |
| 2.2 | Dashboard Layout + Navigation (Sidebar, Header) | ✅ Abgeschlossen |
| 2.3 | Auth-Seiten (Anmelden, Registrieren) + Middleware | ✅ Abgeschlossen |
| 2.4 | Dashboard Übersicht (Stats, Projekte, Usage-Anzeige) | ✅ Abgeschlossen |
| 2.5 | Projekte-Verwaltung: Übersicht, Neu-Erstellen, Sprachauswahl | ✅ Abgeschlossen |
| 2.6 | Projekt-Detail: 7-teilige Sidebar-Navigation (wie Weglot) | ✅ Abgeschlossen |
| 2.7 | Übersetzungen/Sprachen: Sprachpaare mit Wortanzahl + manuell-% | ✅ Abgeschlossen |
| 2.8 | Übersetzungen/URLs: Paginierte URL-Liste mit Wortanzahl | ✅ Abgeschlossen |
| 2.9 | Übersetzungen/Glossar: Glossarregeln + Leer-State | ✅ Abgeschlossen |
| 2.10 | Übersetzungen/URL Slugs: Slug-Verwaltung mit Auto-Translate | ✅ Abgeschlossen |
| 2.11 | Statistiken: Monatlicher Verlauf (Bar-Chart), Top-URLs | ✅ Abgeschlossen |
| 2.12 | API-Keys-Verwaltung pro Projekt | ✅ Abgeschlossen |
| 2.13 | Prisma Schema erweitert: GlossaryRule, UrlSlug, TranslationExclusion, TranslatedUrl | ✅ Abgeschlossen |

---

## Phase 3 – Übersetzungs-Engine

| # | Aufgabe | Status |
|---|---|---|
| 3.1 | DeepL API Integration (Batch-Requests, Fehlerbehandlung) | ✅ Abgeschlossen |
| 3.2 | OpenAI GPT-4 Integration (kontextsensitive Übersetzungen) | ⏳ Offen |
| 3.3 | Plugin-API Endpunkt (`POST /api/translate`) | ✅ Abgeschlossen |
| 3.4 | Caching-Schicht (Hash-basiert, DB-Lookup vor API-Call) | ✅ Abgeschlossen |
| 3.5 | Rate Limiting + API-Key Validierung | ✅ Abgeschlossen |
| 3.6 | Wörter-Zählung + Usage-Tracking pro Subscription | ✅ Abgeschlossen |

---

## Phase 4 – WordPress Plugin

| # | Aufgabe | Status |
|---|---|---|
| 3.7 | Settings: General (Toggles, Website-Typ, Branche) | ✅ Abgeschlossen |
| 3.8 | Settings: Language model (Configure + Testimonial) | ✅ Abgeschlossen |
| 3.9 | Settings: Language Switcher (Toggles, CSS, Sprach-Reihenfolge, Drag & Drop) | ✅ Abgeschlossen |
| 3.10 | Settings: Translation Exclusions (Excluded URLs + Blocks) | ✅ Abgeschlossen |
| 3.11 | Settings: Setup (API-Key Anzeige + WordPress Installationsanleitung) | ✅ Abgeschlossen |
| 3.12 | Settings: WordPress Settings (E-Mail, Suche, AMP) | ✅ Abgeschlossen |
| 3.13 | Settings: Project Members (Tabelle, Rollen, Einladen) | ✅ Abgeschlossen |
| 3.14 | Prisma: ProjectSettings + ProjectMember Modelle | ✅ Abgeschlossen |
| 3.15 | Globale Konto-Einstellungen (My Account, Passwort, 2FA, Notifications, Workspaces) | ✅ Abgeschlossen |
| 3.16 | API Routes: PATCH /api/user, PATCH /api/user/password, DELETE /api/user | ✅ Abgeschlossen |
| 3.17 | Billing: Plan-Übersicht, Karte & Rechnungen, Nutzung (Pie Charts) | ✅ Abgeschlossen |
| 3.18 | API Routes: POST /api/billing/portal, /cancel, /address | ✅ Abgeschlossen |
| 3.19 | Production-Fix: Edge-sichere Auth-/Middleware-Trennung + Routing-Tests | ✅ Abgeschlossen |
| 3.20 | Production-Fix: Root-Route `/` auf echte Marketing-Landingpage umgestellt | ✅ Abgeschlossen |
| 3.21 | Autor-/Projektmetadaten auf Andreas Ostheimer vereinheitlicht | ✅ Abgeschlossen |

| 4.1 | Plugin-Grundgerüst (plugin.php, Autoloader, Service Container) | ✅ Abgeschlossen |
| 4.2 | URL-Klasse (Sprache aus URL, `$_SERVER` Manipulation) | ⏳ Offen |
| 4.3 | Output Buffer + HTML Parser (DiDOM) | ⏳ Offen |
| 4.4 | Deepglot API Client (HTTP-Requests zum Next.js Backend) | ⏳ Offen |
| 4.5 | Lokaler Übersetzungs-Cache (Custom DB-Tabelle) | ⏳ Offen |
| 4.6 | Link-Replacement (HTML, JSON, XML) | ⏳ Offen |
| 4.7 | hreflang Tags + SEO | ⏳ Offen |
| 4.8 | Language Switcher (Shortcode + Widget + Gutenberg Block) | ⏳ Offen |
| 4.9 | Admin-Settings-Page (API-Key, Sprachen, Exclusions) | ⏳ Offen |

---

## Phase 5 – Self-hosted Option

| # | Aufgabe | Status |
|---|---|---|
| 5.1 | Docker Compose Setup (Next.js App + PostgreSQL) | ⏳ Offen |
| 5.2 | Environment-Konfiguration für Self-hosting | ⏳ Offen |
| 5.3 | Installationsanleitung | ⏳ Offen |

---

## Phase 6 – Post-MVP Erweiterungen

| # | Aufgabe | Status |
|---|---|---|
| 6.1 | Visueller Übersetzungs-Editor (Live-Site Bearbeitung) | ⏳ Offen |
| 6.2 | Glossar-Feature (Begriffe nie übersetzen) | ⏳ Offen |
| 6.3 | Import/Export (CSV/PO-Dateien) | ⏳ Offen |
| 6.4 | WooCommerce E-Mail-Übersetzung | ⏳ Offen |
| 6.5 | Browser-Language Auto-Redirect | ⏳ Offen |
| 6.6 | Subdomain-Support (`de.example.com`) | ⏳ Offen |
| 6.7 | Analytics Dashboard (Übersetzungsvolumen, Sprachen-Stats) | ⏳ Offen |
| 6.8 | Webhook-Events (bei neuen Übersetzungen etc.) | ⏳ Offen |

---

## Technische Entscheidungen

| Bereich | Entscheidung | Begründung |
|---|---|---|
| Framework | Next.js 15 (App Router) | Server Components, API Routes, Vercel-optimiert |
| Auth | NextAuth v5 | Open Source, kein Lock-in, self-hosted-kompatibel |
| Datenbank | Neon (serverless PostgreSQL) | Vercel-Integration, serverless, großzügiges Free Tier |
| ORM | Prisma | Type-safe, Migrationen, gute Next.js-Integration |
| Billing | Stripe | Industry-Standard, Subscription-Support |
| UI | Tailwind CSS + shadcn/ui | Schnell, anpassbar, barrierefrei |
| E-Mail | Resend | Next.js-freundlich, günstig |
| Übersetzung (Primary) | DeepL API | Beste Qualität, günstig (€5,99/Mo für 1M Zeichen) |
| Übersetzung (Secondary) | OpenAI GPT-4o | Kontextsensitiv, Glossar-Support |
| WP HTML Parser | DiDOM | Modern, aktiv gepflegt, Composer-ready |

---

## Legende

- ✅ Abgeschlossen
- 🔄 In Arbeit
- ⏳ Offen
- ❌ Blockiert
