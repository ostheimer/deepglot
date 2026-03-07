# Deepglot

Deepglot ist eine mehrsprachige WordPress-Plattform ohne Cloud-Lock-in: eine Next.js-Dashboard-App mit Stripe-Billing, NextAuth, Prisma/Neon und einer kompatiblen Übersetzungs-API für ein eigenes WordPress-Plugin.

## Autor

Andreas Ostheimer  
https://www.ostheimer.at

## Stack

- Next.js 16 + App Router
- TypeScript
- Tailwind CSS + shadcn/ui
- NextAuth v5
- Prisma 7 + Neon PostgreSQL
- Stripe
- DeepL

## Lokale Entwicklung

```bash
npm install
npm run dev
```

Die App läuft danach unter `http://localhost:3000`.

## Wichtige Skripte

```bash
npm run dev
npm run build
npm run lint
npm test
```

## Auth-Architektur

Die Auth-Konfiguration ist absichtlich getrennt:

- `src/lib/auth.config.ts`: edge-sichere Basis-Konfiguration für Middleware
- `src/lib/auth.ts`: serverseitige Konfiguration mit Prisma-Adapter und Providern
- `src/middleware.ts`: nutzt nur die edge-sichere Konfiguration

Diese Trennung verhindert Produktionsfehler wie `MIDDLEWARE_INVOCATION_FAILED` auf Vercel.

## API-Kompatibilität

Die Route `POST /api/translate` ist Weglot-kompatibel:

- `?api_key=...` wird unterstützt
- Response enthält `from_words` und `to_words`
- Public Endpoints:
  - `GET /api/public/status`
  - `GET /api/public/languages`
  - `GET /api/public/languages/is-supported`

## WordPress-Plugin

Das erste Plugin-Grundgerüst liegt unter `wordpress-plugin/deepglot`.

Enthalten sind aktuell:

- Bootstrap-Datei mit Plugin-Header
- Autoloader und kleiner Service-Container
- Admin-Einstellungsseite unter `Einstellungen -> Deepglot`
- vorbereiteter API-Client
- erste testbare URL-Sprachlogik

Plugin-Test lokal:

```bash
php wordpress-plugin/deepglot/tests/UrlLanguageResolverTest.php
```

## Deployment

Die App wird auf Vercel deployed. Für einen lokalen Produktionscheck:

```bash
npm run build
```

Nach Deployments sollte die aktuelle Production-URL sowie der Deployment-Status geprüft werden.
